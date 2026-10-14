import "server-only";
import { eq, sql } from "drizzle-orm";
import { canAccessMarketingUser, type BackofficeActor } from "@/lib/auth/rbac-core";
import { db } from "@/lib/db";
import { consultantClientGoal } from "@/lib/db/schema";
import { readAdAccountMoney } from "@/lib/meta-business/ad-account-money-read";
import { metaApiCall } from "@/lib/meta-business/api";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { cachedMetaRead, tokenCacheId } from "@/lib/meta-business/read-cache";
import { PLAYBOOK_RULE_CREATIVE_DIAGNOSIS, PLAYBOOK_RULE_ROAS_SCALE } from "@/lib/playbook-insights/constants";
import { toAlert } from "./data";
import { getDossierAds } from "./journey-data";
import { workspaceRange } from "./metrics";
import {
  balanceSuggestion,
  creativeBadSuggestions,
  evaluateBalance,
  evaluatePixel,
  firstNameOf,
  isSalesObjective,
  pixelSuggestion,
  scaleSuggestions,
  sortSuggestions,
  type LiveCheckStatus,
  type MessageContext,
  type PixelReading,
  type SuggestedAction,
} from "./playbook-actions";
import type { GoalKpi, WorkspaceGoal } from "./types";

/**
 * Carregadores das ações sugeridas: banco (escalar, criativo ruim) e Graph ao
 * vivo (pixel, saldo). As regras estão em `playbook-actions.ts`.
 *
 * As checagens ao vivo rodam só para UM cliente, sob demanda (página do
 * cliente e MCP) — nunca para a carteira — com cache de 5 min por conta.
 */

type Row = Record<string, unknown>;

async function rows(query: ReturnType<typeof sql>): Promise<Row[]> {
  return Array.from((await db.execute(query)) as unknown as Row[]);
}

const LIVE_CACHE_TTL_MS = 5 * 60 * 1000;
/** Contas checadas por cliente: as de maior gasto recente. */
const LIVE_MAX_ACCOUNTS = 2;

export class SuggestedActionsError extends Error {}

function assertRead(actor: BackofficeActor, userId: string) {
  if (!canAccessMarketingUser(actor, userId)) throw new SuggestedActionsError("Este cliente não está na sua carteira.");
}

/** Situações que saem do banco: campanha validou (insight aberto) e criativo ruim. */
export async function loadSuggestedActions(
  actor: BackofficeActor,
  userId: string,
  days = 7,
): Promise<{ suggestions: SuggestedAction[]; days: number }> {
  assertRead(actor, userId);
  // Leitura enxuta de UM cliente (a Fila chama a cada cliente selecionado): sem a carteira inteira.
  const [alertRows, ads, goalRows, userRows, accountRows] = await Promise.all([
    rows(sql`
      select id, user_id, rule_id, severity, title, evidence, recommendation, entity_level,
        entity_id, entity_name, action_type, metrics, created_at
      from performance_insights
      where user_id = ${userId}::uuid
        and status in ('open','acknowledged')
        and (snoozed_until is null or snoozed_until <= now())
        and rule_id in (${PLAYBOOK_RULE_ROAS_SCALE}, ${PLAYBOOK_RULE_CREATIVE_DIAGNOSIS})
      order by created_at desc
      limit 100
    `),
    getDossierAds(userId, days),
    db.select().from(consultantClientGoal).where(eq(consultantClientGoal.userId, userId)).limit(1),
    rows(sql`select name from users where id = ${userId}::uuid`),
    rows(sql`
      select distinct on (entity_id) entity_id, account_id
      from meta_tracking_config_versions
      where user_id = ${userId}::uuid and entity_level = 'campaign'
      order by entity_id, (valid_to is null) desc, valid_from desc
    `),
  ]);
  const alerts = alertRows.map(toAlert);
  const [goalRow] = goalRows;
  const goal: WorkspaceGoal | undefined = goalRow
    ? { kpi: goalRow.kpi as GoalKpi, target: Number(goalRow.target), monthlyBudget: goalRow.monthlyBudget == null ? null : Number(goalRow.monthlyBudget) }
    : undefined;
  const ctx: MessageContext = { firstName: firstNameOf((userRows[0]?.name as string | null) ?? null) };
  const accountByCampaign = new Map(accountRows.map((row) => [String(row.entity_id), String(row.account_id)]));
  const suggestions = [
    ...scaleSuggestions({ alerts, accountByCampaign, ctx }),
    ...creativeBadSuggestions({ ads, alerts, goal, days, ctx }),
  ];
  return { suggestions: sortSuggestions(suggestions), days };
}

/** Contas do cliente para checar: maior gasto em 30 dias; sem gasto, a última conta coletada. */
async function accountsToCheck(userId: string): Promise<Array<{ accountId: string; avgDailySpend7d: number }>> {
  const range7 = workspaceRange(7);
  const range30 = workspaceRange(30);
  const spent = await rows(sql`
      select account_id,
        sum(spend) as spend30,
        sum(spend) filter (where metric_date >= ${range7.from}::date) as spend7
      from meta_tracking_daily_metrics
      where user_id = ${userId}::uuid and entity_level = 'campaign'
        and metric_date between ${range30.from}::date and ${range30.to}::date
      group by account_id
      having sum(spend) > 0
      order by sum(spend) desc
      limit ${LIVE_MAX_ACCOUNTS}
    `);
  if (spent.length > 0) {
    return spent.map((row) => ({ accountId: String(row.account_id), avgDailySpend7d: Number(row.spend7 ?? 0) / 7 }));
  }
  const [latest] = await rows(sql`
      select account_id from meta_tracking_config_versions
      where user_id = ${userId}::uuid and account_id is not null
      order by valid_from desc
      limit 1
    `);
  return latest?.account_id ? [{ accountId: String(latest.account_id), avgDailySpend7d: 0 }] : [];
}

const actOf = (accountId: string) => (accountId.startsWith("act_") ? accountId : `act_${accountId}`);

/** `last_fired_time` vem como `2026-10-12T15:04:05+0000`; nem todo runtime lê o fuso sem os dois-pontos. */
function isoTime(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const time = Date.parse(normalized);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Pixels da conta (`act_X/adspixels`), com cache de 5 min por conta e token. */
export async function readAdAccountPixels(args: { adAccountId: string; accessToken: string; fresh?: boolean }): Promise<PixelReading[]> {
  const act = actOf(args.adAccountId);
  return cachedMetaRead({
    key: `adspixels:${tokenCacheId(args.accessToken)}:${act}`,
    ttlMs: LIVE_CACHE_TTL_MS,
    forceRefresh: args.fresh === true,
    fetcher: async () => {
      const response = await metaApiCall<{ data?: Array<Record<string, unknown>> }>({
        domain: "FACEBOOK",
        method: "GET",
        path: `${act}/adspixels`,
        params: "fields=id,name,last_fired_time,is_unavailable&limit=25",
        accessToken: args.accessToken,
      });
      return (response.data ?? []).map((pixel) => ({
        id: String(pixel.id ?? ""),
        name: typeof pixel.name === "string" ? pixel.name : null,
        lastFiredTime: isoTime(pixel.last_fired_time),
        isUnavailable: pixel.is_unavailable === true,
      }));
    },
  });
}

const CHECK_FAILED = "não consegui checar agora";

/**
 * Checagens ao vivo de UM cliente: pixel e saldo/pagamento de cada conta com
 * gasto recente. Cada checagem falha sozinha ("não consegui checar agora").
 */
export async function runLiveChecks(
  actor: BackofficeActor,
  userId: string,
  options: { days?: number; fresh?: boolean } = {},
): Promise<{ suggestions: SuggestedAction[]; checks: LiveCheckStatus[] }> {
  assertRead(actor, userId);
  const days = options.days ?? 7;
  const range = workspaceRange(days);
  const [accounts, token, campaignRows, configRows, userRows] = await Promise.all([
    accountsToCheck(userId),
    getUserAccessTokenByUserId(userId),
    // Campanhas do período (dados da coleta): "vendas gastando sem compra" vem daqui, sem Graph.
    rows(sql`
      select entity_id, account_id, sum(spend) as spend, sum(purchases) as purchases
      from meta_tracking_daily_metrics
      where user_id = ${userId}::uuid and entity_level = 'campaign'
        and metric_date between ${range.from}::date and ${range.to}::date
      group by entity_id, account_id
      having sum(spend) > 0
    `),
    rows(sql`
      select distinct on (entity_id) entity_id, entity_name, objective
      from meta_tracking_config_versions
      where user_id = ${userId}::uuid and entity_level = 'campaign'
      order by entity_id, (valid_to is null) desc, valid_from desc
    `),
    rows(sql`select name from users where id = ${userId}::uuid`),
  ]);
  const configById = new Map(configRows.map((row) => [String(row.entity_id), row]));
  const campaigns = campaignRows.map((row) => {
    const config = configById.get(String(row.entity_id));
    return {
      campaignId: String(row.entity_id),
      accountId: String(row.account_id),
      name: String(config?.entity_name ?? row.entity_id),
      objective: (config?.objective as string | null) ?? null,
      spend: Number(row.spend ?? 0),
      purchases: Number(row.purchases ?? 0),
    };
  });
  const now = new Date();
  const fail = (check: LiveCheckStatus["check"], summary: string, adAccountId: string | null = null): LiveCheckStatus => ({
    check,
    status: "error",
    summary,
    adAccountId,
    checkedAt: now.toISOString(),
  });
  if (!token.success) {
    const reason = token.error.needsReconnect || token.error.error === "reconnect_required"
      ? "o Facebook do cliente está desconectado — peça para reconectar"
      : token.error.statusCode === 404
        ? "o cliente ainda não conectou o Facebook"
        : CHECK_FAILED;
    return { suggestions: [], checks: [fail("pixel", `Pixel: ${reason}`), fail("balance", `Saldo: ${reason}`)] };
  }
  if (accounts.length === 0) {
    return {
      suggestions: [],
      checks: [fail("pixel", "Pixel: nenhuma conta de anúncios coletada ainda"), fail("balance", "Saldo: nenhuma conta de anúncios coletada ainda")],
    };
  }

  const ctx: MessageContext = { firstName: firstNameOf((userRows[0]?.name as string | null) ?? null) };
  const suggestions: SuggestedAction[] = [];
  const checks: LiveCheckStatus[] = [];

  await Promise.all(
    accounts.map(async ({ accountId, avgDailySpend7d }) => {
      const act = actOf(accountId);
      const accountCampaigns = campaigns.filter((campaign) => actOf(campaign.accountId) === act);

      const [pixelResult, moneyResult] = await Promise.allSettled([
        readAdAccountPixels({ adAccountId: act, accessToken: token.accessToken, fresh: options.fresh }),
        readAdAccountMoney({ adAccountId: act, accessToken: token.accessToken, fresh: options.fresh }),
      ]);

      const accountName = moneyResult.status === "fulfilled" ? moneyResult.value.name : null;

      if (pixelResult.status === "fulfilled") {
        const verdict = evaluatePixel({
          pixels: pixelResult.value,
          salesCampaigns: accountCampaigns.filter((campaign) => isSalesObjective(campaign.objective)),
          days,
          now,
        });
        const suggestion = pixelSuggestion({ verdict, adAccountId: act, accountName, ctx });
        if (suggestion) suggestions.push(suggestion);
        checks.push({ check: "pixel", status: verdict.status, summary: verdict.summary, adAccountId: act, checkedAt: now.toISOString() });
      } else {
        console.warn("[consultant-workspace live-check] pixel", { userId, act, error: String(pixelResult.reason) });
        checks.push(fail("pixel", `Pixel: ${CHECK_FAILED}`, act));
      }

      if (moneyResult.status === "fulfilled") {
        const read = moneyResult.value;
        const verdict = evaluateBalance({
          currency: read.currency,
          isPrepaid: read.isPrepaid,
          money: read.money,
          accountStatus: read.accountStatus,
          disableReason: read.disableReason,
          amountSpent: read.amountSpent,
          spendCap: read.spendCap,
          avgDailySpend7d,
        });
        const suggestion = balanceSuggestion({ verdict, adAccountId: act, accountName: read.name, ctx });
        if (suggestion) suggestions.push(suggestion);
        checks.push({ check: "balance", status: verdict.status, summary: verdict.summary, adAccountId: act, checkedAt: read.fetchedAt });
      } else {
        console.warn("[consultant-workspace live-check] balance", { userId, act, error: String(moneyResult.reason) });
        checks.push(fail("balance", `Saldo: ${CHECK_FAILED}`, act));
      }
    }),
  );

  return { suggestions: sortSuggestions(suggestions), checks };
}
