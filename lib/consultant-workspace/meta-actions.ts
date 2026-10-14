import "server-only";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { runAsBackofficeActor } from "@/lib/auth/actor-context";
import { canAccessMarketingUser, hasBackofficePermission, type BackofficeActor } from "@/lib/auth/rbac-core";
import { db } from "@/lib/db";
import { metaApiCall } from "@/lib/meta-business/api";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { PATCH as patchCampaigns } from "@/app/api/meta-marketing/[accountId]/campaigns/route";
import { PATCH as patchAdSets } from "@/app/api/meta-marketing/[accountId]/adsets/route";
import { PATCH as patchAds } from "@/app/api/meta-marketing/[accountId]/ads/route";
import { PATCH as editAdSet } from "@/app/api/meta-marketing/[accountId]/adsets/[adsetId]/edit/route";
import { POST as duplicateCampaign } from "@/app/api/meta-marketing/[accountId]/campaigns/[campaignId]/duplicate/route";
import { POST as duplicateAdSet } from "@/app/api/meta-marketing/[accountId]/adsets/[adsetId]/duplicate/route";
import { POST as duplicateAd } from "@/app/api/meta-marketing/[accountId]/ads/[adId]/duplicate/route";
import { formatMoney } from "./metrics";

/**
 * Ações na Meta da área de Tráfego (tela e MCP).
 *
 * Não reimplementa nada: chama as MESMAS rotas que a tela de Marketing usa —
 * mesma validação, mesma nota obrigatória, mesmo log de auditoria e mesmo
 * evento interno na coleta — com o colaborador já verificado como ator
 * (`runAsBackofficeActor`). Antes de agir, lê o estado ao vivo na Meta.
 */

export type MetaChangeAction = "pause" | "activate" | "set_daily_budget" | "duplicate";

export type MetaChange = {
  userId: string;
  entityId: string;
  action: MetaChangeAction;
  /** set_daily_budget: novo orçamento diário em reais. */
  value?: number;
  note: string;
};

type Level = "campaign" | "adset" | "ad";

type EntityRef = {
  level: Level;
  accountId: string;
  name: string | null;
  campaignId: string | null;
};

export type MetaChangePreview = {
  userId: string;
  entityId: string;
  entity: string;
  level: Level | null;
  action: MetaChangeAction;
  from: string | null;
  to: string | null;
  warnings: string[];
  /** Impede aplicar (entidade não encontrada, orçamento no outro nível, valor ausente…). */
  blocking: string[];
};

const LEVEL_LABEL: Record<Level, string> = { campaign: "campanha", adset: "conjunto", ad: "anúncio" };

export class MetaActionError extends Error {}

function assertCanAct(actor: BackofficeActor, userId: string) {
  if (!hasBackofficePermission(actor, "marketing:write")) throw new MetaActionError("Seu cargo não pode alterar campanhas.");
  if (!canAccessMarketingUser(actor, userId)) throw new MetaActionError("Este cliente não está na sua carteira.");
}

async function lookupEntity(userId: string, entityId: string): Promise<EntityRef | null> {
  const [row] = Array.from(
    (await db.execute(sql`
      select entity_level, account_id, entity_name, campaign_id
      from meta_tracking_config_versions
      where user_id = ${userId}::uuid and entity_id = ${entityId}
      order by (valid_to is null) desc, valid_from desc
      limit 1
    `)) as unknown as Array<Record<string, unknown>>,
  );
  if (row) {
    return {
      level: String(row.entity_level) as Level,
      accountId: String(row.account_id),
      name: (row.entity_name as string | null) ?? null,
      campaignId: (row.campaign_id as string | null) ?? null,
    };
  }
  // Criado depois da última coleta (ex.: hoje): pergunta à Meta o tipo e a conta.
  return lookupEntityLive(userId, entityId);
}

/** Um campo que só existe naquele nível: a Meta recusa campo inexistente, então a primeira leitura que passar diz o nível. */
const LEVEL_PROBES: Array<{ level: Level; field: string }> = [
  { level: "ad", field: "adset_id" },
  { level: "adset", field: "optimization_goal" },
  { level: "campaign", field: "objective" },
];

async function lookupEntityLive(userId: string, entityId: string): Promise<EntityRef | null> {
  if (!/^\d{5,25}$/.test(entityId)) return null;
  const token = await getUserAccessTokenByUserId(userId);
  if (!token.success) return null;
  for (const probe of LEVEL_PROBES) {
    try {
      const node = await metaApiCall<{ name?: string; account_id?: string }>({
        domain: "FACEBOOK",
        method: "GET",
        path: entityId,
        params: `fields=name,account_id,${probe.field}`,
        accessToken: token.accessToken,
      });
      if (!node.account_id) return null;
      // O token do cliente só enxerga as contas dele: achar o nó já prova que é do cliente.
      return { level: probe.level, accountId: `act_${node.account_id}`, name: node.name ?? null, campaignId: null };
    } catch {
      // campo não existe neste nível (ou sem acesso): tenta o próximo
    }
  }
  return null;
}

type LiveState = { status: string | null; dailyBudget: number | null; lifetimeBudget: number | null; name: string | null };

async function readLive(userId: string, entityId: string, level: Level): Promise<LiveState> {
  const token = await getUserAccessTokenByUserId(userId);
  if (!token.success) throw new MetaActionError("O Facebook do cliente está desconectado — reconecte antes de agir.");
  const fields = level === "ad" ? "name,status" : "name,status,daily_budget,lifetime_budget";
  const live = await metaApiCall<{ name?: string; status?: string; daily_budget?: string; lifetime_budget?: string }>({
    domain: "FACEBOOK",
    method: "GET",
    path: entityId,
    params: `fields=${fields}`,
    accessToken: token.accessToken,
  });
  const reais = (minor?: string) => (minor && Number(minor) > 0 ? Number(minor) / 100 : null);
  return { status: live.status ?? null, dailyBudget: reais(live.daily_budget), lifetimeBudget: reais(live.lifetime_budget), name: live.name ?? null };
}

/** Prévia de uma mudança: estado atual na Meta → novo, com avisos. Não altera nada. */
export async function previewMetaChange(actor: BackofficeActor, change: MetaChange): Promise<MetaChangePreview> {
  assertCanAct(actor, change.userId);
  const base: MetaChangePreview = {
    userId: change.userId,
    entityId: change.entityId,
    entity: change.entityId,
    level: null,
    action: change.action,
    from: null,
    to: null,
    warnings: [],
    blocking: [],
  };
  if (!change.note?.trim() || change.note.trim().length < 5) base.blocking.push("Escreva o motivo (nota) da mudança.");
  const ref = await lookupEntity(change.userId, change.entityId);
  if (!ref) {
    base.blocking.push("Não encontrei esta campanha/conjunto/anúncio na conta do cliente.");
    return base;
  }
  base.level = ref.level;
  let live: LiveState;
  try {
    live = await readLive(change.userId, change.entityId, ref.level);
  } catch (error) {
    base.entity = `${LEVEL_LABEL[ref.level]} ${ref.name ?? change.entityId}`;
    base.blocking.push(error instanceof Error ? error.message : "Não consegui ler o estado atual na Meta.");
    return base;
  }
  base.entity = `${LEVEL_LABEL[ref.level]} ${live.name ?? ref.name ?? change.entityId}`;

  if (change.action === "pause" || change.action === "activate") {
    const next = change.action === "pause" ? "PAUSED" : "ACTIVE";
    base.from = live.status;
    base.to = next;
    if (live.status === next) base.warnings.push(`Já está ${next === "PAUSED" ? "pausado" : "ativo"}.`);
  }
  if (change.action === "set_daily_budget") {
    base.to = change.value ? formatMoney(change.value) : null;
    if (!change.value || change.value < 1) base.blocking.push("Informe o novo orçamento diário (mínimo R$ 1).");
    if (ref.level === "ad") base.blocking.push("Anúncio não tem orçamento: mude no conjunto ou na campanha.");
    else if (live.lifetimeBudget) base.blocking.push("Este item usa orçamento total, não diário — ajuste pela tela de Marketing.");
    else if (!live.dailyBudget) {
      base.blocking.push(
        ref.level === "campaign"
          ? "O orçamento desta campanha fica nos conjuntos: mude no conjunto."
          : "O orçamento deste conjunto fica na campanha: mude na campanha.",
      );
    } else {
      base.from = formatMoney(live.dailyBudget);
      if (change.value) {
        const ratio = change.value / live.dailyBudget;
        if (ratio > 1.5) base.warnings.push(`Aumento de ${Math.round((ratio - 1) * 100)}% de uma vez: a Meta pode reiniciar o aprendizado. Prefira até +20–30%.`);
        if (ratio < 0.5) base.warnings.push(`Corte de ${Math.round((1 - ratio) * 100)}% no orçamento.`);
      }
    }
  }
  if (change.action === "duplicate") {
    base.to = "cópia pausada";
    base.warnings.push("A cópia é criada pausada, como na tela.");
  }
  return base;
}

async function callRoute(
  handler: (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>,
  path: string,
  method: "PATCH" | "POST",
  params: Record<string, string>,
  body: unknown,
) {
  const request = new NextRequest(new URL(path, "http://backoffice.internal"), {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await handler(request, { params: Promise.resolve(params) });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || payload.success === false) {
    const message = String(payload.message ?? payload.error ?? `Falha na Meta (${response.status})`);
    throw new MetaActionError(message);
  }
  return payload;
}

/**
 * Executa a mudança pelas rotas da tela, como `actor`. Refaz a prévia antes
 * (estado ao vivo) e recusa se algo bloquear — a prévia aprovada pode ter
 * envelhecido.
 */
export async function applyMetaChange(
  actor: BackofficeActor,
  change: MetaChange,
  source: "backoffice" | "mcp" = "backoffice",
): Promise<{ entity: string; summary: string }> {
  const preview = await previewMetaChange(actor, change);
  if (preview.blocking.length > 0) throw new MetaActionError(preview.blocking.join(" "));
  const ref = (await lookupEntity(change.userId, change.entityId))!;
  const note = source === "mcp" ? `${change.note.trim()} (via Claude)` : change.note.trim();
  const { userId, entityId } = change;
  const accountId = ref.accountId;
  const query = `?userId=${encodeURIComponent(userId)}`;

  await runAsBackofficeActor(actor, async () => {
    if (change.action === "pause" || change.action === "activate") {
      const status = change.action === "pause" ? "PAUSED" : "ACTIVE";
      if (ref.level === "campaign") {
        await callRoute(patchCampaigns as never, `/api/meta-marketing/${accountId}/campaigns${query}`, "PATCH", { accountId }, { campaignId: entityId, status, note });
      } else if (ref.level === "adset") {
        await callRoute(patchAdSets as never, `/api/meta-marketing/${accountId}/adsets${query}`, "PATCH", { accountId }, { adsetId: entityId, status, note });
      } else {
        await callRoute(patchAds as never, `/api/meta-marketing/${accountId}/ads${query}`, "PATCH", { accountId }, { adId: entityId, status, note });
      }
      return;
    }
    if (change.action === "set_daily_budget") {
      if (ref.level === "campaign") {
        // Só chega aqui com orçamento diário NA campanha (CBO), conferido ao vivo na prévia.
        await callRoute(patchCampaigns as never, `/api/meta-marketing/${accountId}/campaigns${query}`, "PATCH", { accountId }, {
          campaignId: entityId,
          mode: "CBO",
          budgetType: "daily",
          dailyBudget: change.value,
          note,
        });
      } else {
        await callRoute(editAdSet as never, `/api/meta-marketing/${accountId}/adsets/${entityId}/edit`, "PATCH", { accountId, adsetId: entityId }, {
          userId,
          dailyBudget: change.value,
          note,
        });
      }
      return;
    }
    if (change.action === "duplicate") {
      if (ref.level === "campaign") {
        await callRoute(duplicateCampaign as never, `/api/meta-marketing/${accountId}/campaigns/${entityId}/duplicate${query}`, "POST", { accountId, campaignId: entityId }, {});
      } else if (ref.level === "adset") {
        await callRoute(duplicateAdSet as never, `/api/meta-marketing/${accountId}/adsets/${entityId}/duplicate${query}`, "POST", { accountId, adsetId: entityId }, {});
      } else {
        await callRoute(duplicateAd as never, `/api/meta-marketing/${accountId}/ads/${entityId}/duplicate${query}`, "POST", { accountId, adId: entityId }, {});
      }
    }
  });

  return { entity: preview.entity, summary: `${preview.entity}: ${preview.from ?? ""}${preview.to ? ` → ${preview.to}` : ""}`.trim() };
}
