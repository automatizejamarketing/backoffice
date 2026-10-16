import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { emptyTotals, primaryKpi, workspaceRange } from "./metrics";
import type { JourneyExtras } from "./journey";
import type { PerfTotals, PrimaryKpi } from "./types";

/**
 * Leituras extras da variação D (jornada). Mesmo contrato do data.ts: banco
 * de produção, só leitura, nada da Graph API.
 *
 * Atenção: as métricas diárias só existem desde a coleta (meados de setembro
 * de 2026); "nunca gastou" quer dizer "não gastou desde então".
 */

type Row = Record<string, unknown>;

async function rows(query: ReturnType<typeof sql>): Promise<Row[]> {
  return Array.from((await db.execute(query)) as unknown as Row[]);
}

const iso = (value: unknown) =>
  value == null ? null : value instanceof Date ? value.toISOString() : String(value);

/** Cache por cliente (2 min), pelo mesmo motivo do cache da carteira em data.ts. */
const EXTRAS_TTL_MS = 2 * 60 * 1000;
const extrasCache = new Map<string, { at: number; value: JourneyExtras }>();
let extrasInflight: Promise<Record<string, JourneyExtras>> | null = null;

export async function getJourneyExtras(userIds: string[]): Promise<Record<string, JourneyExtras>> {
  const now = Date.now();
  const result: Record<string, JourneyExtras> = {};
  let missing: string[] = [];
  for (const id of userIds) {
    const hit = extrasCache.get(id);
    if (hit && now - hit.at < EXTRAS_TTL_MS) result[id] = hit.value;
    else missing.push(id);
  }
  if (missing.length > 0 && extrasInflight) {
    // Outra página já está carregando: espera e reaproveita o que ela trouxer.
    await extrasInflight.catch(() => undefined);
    missing = missing.filter((id) => {
      const hit = extrasCache.get(id);
      if (hit) result[id] = hit.value;
      return !hit;
    });
  }
  if (missing.length === 0) return result;
  const run = loadJourneyExtras(missing);
  extrasInflight = run;
  try {
    const loaded = await run;
    for (const [id, value] of Object.entries(loaded)) {
      extrasCache.set(id, { at: Date.now(), value });
      result[id] = value;
    }
  } finally {
    if (extrasInflight === run) extrasInflight = null;
  }
  return result;
}

async function loadJourneyExtras(userIds: string[]): Promise<Record<string, JourneyExtras>> {
  if (userIds.length === 0) return {};
  const ids = sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `);
  const [base, spend, campaigns] = await Promise.all([
    rows(sql`
      select u.id::text as user_id, u.created_at,
        coalesce(co.onboarding_completed, false) as onboarding_completed,
        cert.bisu_status, crm.commercial_status
      from users u
      left join lateral (
        select c.onboarding_completed from user_companies uc join companies c on c.id = uc.company_id
        where uc.user_id = u.id order by uc.created_at asc limit 1
      ) co on true
      left join meta_certification_states cert on cert.user_id = u.id
      left join crm_leads crm on crm.user_id = u.id
      where u.id in (${ids})
    `),
    rows(sql`
      select user_id::text as user_id, min(metric_date)::text as first_spend, max(metric_date)::text as last_spend
      from meta_tracking_daily_metrics
      where entity_level = 'campaign' and spend > 0 and user_id in (${ids})
      group by user_id
    `),
    rows(sql`
      select distinct user_id::text as user_id from meta_tracking_config_versions
      where entity_level = 'campaign' and user_id in (${ids})
    `),
  ]);
  const spendBy = new Map(spend.map((row) => [String(row.user_id), row]));
  const withCampaign = new Set(campaigns.map((row) => String(row.user_id)));
  const result: Record<string, JourneyExtras> = {};
  for (const row of base) {
    const userId = String(row.user_id);
    const spendRow = spendBy.get(userId);
    result[userId] = {
      userId,
      signupAt: iso(row.created_at),
      companyOnboardingCompleted: Boolean(row.onboarding_completed),
      certification: (row.bisu_status as string | null) ?? null,
      hasCampaign: withCampaign.has(userId),
      firstSpendDate: (spendRow?.first_spend as string | undefined) ?? null,
      lastSpendDate: (spendRow?.last_spend as string | undefined) ?? null,
      crmStatus: (row.commercial_status as string | null) ?? null,
    };
  }
  return result;
}

export type DossierAd = {
  adId: string;
  name: string;
  campaignId: string | null;
  adsetId: string | null;
  campaignName: string | null;
  adsetName: string | null;
  /** "act_…" — para o link do Gerenciador. */
  accountId: string | null;
  status: string | null;
  /** Só a URL guardada (assinada, pode ter expirado); a prévia ao vivo vem de /ads/previews. */
  imageUrl: string | null;
  isVideo: boolean;
  current: PerfTotals;
  previous: PerfTotals;
  kpi: PrimaryKpi;
  previousKpi: PrimaryKpi;
  /** Parcela do gasto do cliente no período. */
  spendShare: number;
};

/** Anúncios do período (para pausar/trocar criativo no dossiê), maior gasto primeiro. */
export async function getDossierAds(userId: string, days = 7): Promise<DossierAd[]> {
  const range = workspaceRange(days);
  const [metricRows, nameRows] = await Promise.all([
    rows(sql`
      select entity_id as ad_id, campaign_id, adset_id, metric_date::text as metric_date,
        spend, impressions, clicks, link_clicks, results, purchases, purchase_value, leads,
        messaging_conversations_started as conversations
      from meta_tracking_daily_metrics
      where user_id = ${userId}::uuid and entity_level = 'ad'
        and metric_date between ${range.prevFrom}::date and ${range.to}::date
    `),
    rows(sql`
      select distinct on (v.entity_id) v.entity_id, v.entity_level, v.entity_name,
        v.configured_status, v.creative_id, v.account_id,
        cr.spec->>'image_url' as image_url, (cr.spec ? 'video_id' or coalesce(cr.spec->'asset_feed_spec' ? 'videos', false)) as is_video
      from meta_tracking_config_versions v
      left join meta_tracking_creatives cr on cr.id = v.creative_id
      where v.user_id = ${userId}::uuid and v.entity_level in ('ad','adset','campaign')
      order by v.entity_id, (v.valid_to is null) desc, v.valid_from desc
    `),
  ]);
  const names = new Map(nameRows.map((row) => [String(row.entity_id), row]));
  const ads = new Map<string, { campaignId: string; adsetId: string; current: PerfTotals; previous: PerfTotals }>();
  let totalSpend = 0;
  for (const row of metricRows) {
    const id = String(row.ad_id);
    let entry = ads.get(id);
    if (!entry) {
      entry = {
        campaignId: String(row.campaign_id ?? ""),
        adsetId: String(row.adset_id ?? ""),
        current: emptyTotals(),
        previous: emptyTotals(),
      };
      ads.set(id, entry);
    }
    const target = String(row.metric_date) >= range.from ? entry.current : entry.previous;
    target.spend += Number(row.spend ?? 0);
    target.impressions += Number(row.impressions ?? 0);
    target.clicks += Number(row.clicks ?? 0);
    target.linkClicks += Number(row.link_clicks ?? 0);
    target.results += Number(row.results ?? 0);
    target.purchases += Number(row.purchases ?? 0);
    target.purchaseValue += Number(row.purchase_value ?? 0);
    target.leads += Number(row.leads ?? 0);
    target.conversations += Number(row.conversations ?? 0);
    if (String(row.metric_date) >= range.from) totalSpend += Number(row.spend ?? 0);
  }
  return [...ads.entries()]
    .filter(([, entry]) => entry.current.spend > 0 || entry.previous.spend > 0)
    .map(([adId, entry]) => {
      const meta = names.get(adId);
      const all = emptyTotals();
      for (const key of Object.keys(all) as (keyof PerfTotals)[]) all[key] = entry.current[key] + entry.previous[key];
      const kind = primaryKpi(all).kind;
      return {
        adId,
        name: String(meta?.entity_name ?? adId),
        campaignId: entry.campaignId || null,
        adsetId: entry.adsetId || null,
        campaignName: (names.get(entry.campaignId)?.entity_name as string | null) ?? null,
        adsetName: (names.get(entry.adsetId)?.entity_name as string | null) ?? null,
        accountId: (meta?.account_id as string | null) ?? null,
        status: (meta?.configured_status as string | null) ?? null,
        imageUrl: (meta?.image_url as string | null) ?? null,
        isVideo: Boolean(meta?.is_video),
        current: entry.current,
        previous: entry.previous,
        kpi: primaryKpi(entry.current, kind),
        previousKpi: primaryKpi(entry.previous, kind),
        spendShare: totalSpend > 0 ? entry.current.spend / totalSpend : 0,
      };
    })
    .sort((a, b) => b.current.spend - a.current.spend)
    .slice(0, 60);
}
