import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { canAccessMarketingUser, type BackofficeActor } from "@/lib/auth/rbac-core";
import { recordStatusChangeAudit } from "@/lib/backoffice/meta-status-change-audit";
import { db } from "@/lib/db";
import { recordInternalChangeEvent } from "@/lib/db/meta-tracking-event-queries";
import { metaAdsBatch, type MetaAdsBatch } from "@/lib/db/schema";
import { metaApiCall } from "@/lib/meta-business/api";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import { mapErrorKind } from "@/lib/meta-business/insights/envelope";
import { metaWrite } from "@/lib/meta-business/write-retry";
import { buildInternalChangeEvent } from "@/lib/meta-tracking/internal-change-event";
import { loadClientLabels } from "./meta-ads-queries";
import {
  actId, batchStatusAfterRun, decideAtConfirm, describeItem, objectKey, pendingItems, planItem, writeBody,
  type BatchItemInput, type BatchLevel, type MetaObjectState, type PlannedItem,
} from "./meta-batch-core";

/**
 * Lote de ações em Meta Ads pelo MCP: prévia (lê a Meta e guarda o plano) → confirmação
 * (executa o plano uma vez) → resultado. Escreve com o token do próprio cliente, como as
 * telas do backoffice, e registra cada mudança no mesmo stream de auditoria delas.
 */

/** A prévia vale 15 minutos; um lote interrompido pelo tempo da chamada pode continuar por 1 hora. */
const PREVIEW_TTL_MS = 15 * 60 * 1000;
/** Tempo de execução por chamada, abaixo do maxDuration da rota (120 s), com folga para um retry de throttle. */
const RUN_BUDGET_MS = 60_000;
/** Clientes em paralelo; dentro de um cliente (um token), uma escrita por vez. */
const CLIENTS_IN_PARALLEL = 3;

const FIELDS: Record<BatchLevel, string> = {
  campaign: "id,name,status,effective_status,account_id,daily_budget,lifetime_budget",
  adset: "id,name,status,effective_status,account_id,campaign_id,daily_budget,lifetime_budget,campaign{daily_budget,lifetime_budget}",
  ad: "id,name,status,effective_status,account_id,campaign_id,adset_id",
};

type RawObject = {
  id: string; name?: string; status?: string; effective_status?: string; account_id?: string;
  daily_budget?: string; lifetime_budget?: string; campaign_id?: string; adset_id?: string;
  campaign?: { daily_budget?: string; lifetime_budget?: string };
};

function normalize(raw: RawObject): MetaObjectState {
  return {
    id: raw.id, name: raw.name ?? null, accountId: raw.account_id ?? null,
    status: raw.status ?? null, effectiveStatus: raw.effective_status ?? null,
    dailyBudget: raw.daily_budget ?? null, lifetimeBudget: raw.lifetime_budget ?? null,
    campaignId: raw.campaign_id ?? null, adsetId: raw.adset_id ?? null,
    campaignDailyBudget: raw.campaign?.daily_budget ?? null, campaignLifetimeBudget: raw.campaign?.lifetime_budget ?? null,
  };
}

function errorText(error: unknown): string {
  const mapped = mapErrorKind(error);
  return mapped.metaMessage ? `${mapped.message} (${mapped.metaMessage})` : mapped.message;
}

/**
 * Lê objetos de um nível, 50 por chamada (`?ids=`). Um id sem acesso derruba a leitura
 * múltipla inteira, então nesse caso cai para um a um: o que falhar fica de fora do mapa.
 */
async function readObjects(accessToken: string, level: BatchLevel, ids: string[]): Promise<Map<string, MetaObjectState>> {
  const found = new Map<string, MetaObjectState>();
  const fields = `fields=${encodeURIComponent(FIELDS[level])}`;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const res = await metaApiCall<Record<string, RawObject>>({ method: "GET", path: "", params: `ids=${chunk.join(",")}&${fields}`, accessToken });
      for (const raw of Object.values(res)) if (raw?.id) found.set(raw.id, normalize(raw));
    } catch {
      for (const id of chunk) {
        try {
          found.set(id, normalize(await metaApiCall<RawObject>({ method: "GET", path: id, params: fields, accessToken })));
        } catch { /* sem acesso ou não existe: o item explica */ }
      }
    }
  }
  return found;
}

async function readItems(accessToken: string, items: { level: BatchLevel; id: string }[]): Promise<Map<string, MetaObjectState>> {
  const byKey = new Map<string, MetaObjectState>();
  for (const level of ["campaign", "adset", "ad"] as const) {
    const ids = items.filter(i => i.level === level).map(i => i.id);
    if (ids.length === 0) continue;
    for (const [id, state] of await readObjects(accessToken, level, ids)) byKey.set(objectKey({ level, id }), state);
  }
  return byKey;
}

async function inGroups<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(run));
}

function groupByClient<T extends { userId: string }>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.userId, [...(groups.get(item.userId) ?? []), item]);
  return [...groups];
}

async function describeBatch(row: Pick<MetaAdsBatch, "id" | "status" | "note" | "expiresAt" | "confirmedAt" | "finishedAt">, items: PlannedItem[]) {
  const labels = await loadClientLabels([...new Set(items.map(i => i.userId))]);
  const count = (predicate: (i: PlannedItem) => boolean) => items.filter(predicate).length;
  return {
    batchId: row.id,
    status: row.status,
    note: row.note,
    expiresAt: row.status === "previewed" ? row.expiresAt.toISOString() : undefined,
    confirmedAt: row.confirmedAt?.toISOString(),
    finishedAt: row.finishedAt?.toISOString(),
    summary: {
      total: items.length,
      toRun: count(i => i.plan === "run"),
      skipped: count(i => i.plan === "skip"),
      applied: count(i => i.outcome === "applied"),
      alreadyApplied: count(i => i.outcome === "already_applied"),
      changedSincePreview: count(i => i.outcome === "changed_since_preview"),
      failed: count(i => i.outcome === "failed"),
      pending: pendingItems(items).length,
    },
    items: items.map((item, index) => describeItem(item, index, labels.get(item.userId)?.client ?? item.userId)),
  };
}

export async function previewMetaBatch(actor: BackofficeActor, input: { items: BatchItemInput[]; note: string }) {
  const outside = [...new Set(input.items.map(i => i.userId))].filter(userId => !canAccessMarketingUser(actor, userId));
  if (outside.length) throw new Error(`Fora da sua carteira: ${outside.join(", ")}.`);
  const keys = input.items.map(objectKey);
  const repeated = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (repeated.length) throw new Error(`O mesmo objeto aparece mais de uma vez: ${[...new Set(repeated)].join(", ")}.`);

  const planned: PlannedItem[] = new Array(input.items.length);
  const indexed = input.items.map((item, index) => ({ ...item, index }));
  await inGroups(groupByClient(indexed), CLIENTS_IN_PARALLEL, async ([userId, entries]) => {
    let failure: string | null = null;
    let accounts = new Map<string, string | null>();
    let objects = new Map<string, MetaObjectState>();
    try {
      const token = await getUserAccessTokenByUserId(userId);
      if (!token.success) {
        failure = `Sem acesso à Meta deste cliente: ${token.error.message}`;
      } else {
        const { connection } = token;
        const profile = await getUserWithAdAccounts(token.accessToken, {
          tokenKind: connection.tokenKind, bisuAppScopedId: connection.bisuAppScopedId,
          clientBusinessId: connection.clientBusinessId, connectionName: connection.name,
        });
        accounts = new Map((profile.adaccounts?.data ?? []).map(a => [actId(a.account_id ?? a.id)!, a.currency ?? null]));
        objects = await readItems(token.accessToken, entries);
      }
    } catch (error) {
      failure = `Não foi possível ler a Meta deste cliente: ${errorText(error)}`;
    }
    for (const { index, ...item } of entries) {
      const plan = planItem(item, objects.get(objectKey(item)), accounts);
      planned[index] = failure ? { ...plan, plan: "skip", skipReason: failure, warning: undefined } : plan;
    }
  });

  const runnable = planned.some(i => i.plan === "run");
  const [row] = runnable
    ? await db.insert(metaAdsBatch).values({
      actorId: actor.id, note: input.note.trim(), items: planned as unknown as Record<string, unknown>[],
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
    }).returning()
    : [null];
  const described = await describeBatch(
    row ?? { id: "", status: "previewed", note: input.note.trim(), expiresAt: new Date(), confirmedAt: null, finishedAt: null },
    planned,
  );
  return row
    ? { ...described, next: "Mostre esta prévia ao usuário (itens, avisos e pulados) e só chame confirm_meta_batch com este batchId depois de aprovação explícita." }
    : { ...described, batchId: null, expiresAt: undefined, next: "Nada a executar: todos os itens foram pulados (veja o motivo de cada um)." };
}

async function audit(actor: BackofficeActor, batch: { id: string; note: string }, item: PlannedItem, appliedToMeta: boolean, errorMessage?: string) {
  const note = `${batch.note} [lote ${batch.id.slice(0, 8)} via MCP]`;
  const occurredAt = new Date();
  try {
    if (item.target.status) {
      await recordStatusChangeAudit({
        entity: item.level, backofficeUserEmail: actor.email, targetUserId: item.userId, accountId: item.accountId!,
        objectId: item.id, objectName: item.name, campaignId: item.campaignId, adsetId: item.adsetId,
        previousStatus: item.before.status, newStatus: item.target.status, note, occurredAt, appliedToMeta, errorMessage,
      });
      return;
    }
    const event = buildInternalChangeEvent({
      source: "backoffice_admin", userId: item.userId, accountId: item.accountId!, entityLevel: item.level,
      entityId: item.id, entityName: item.name, campaignId: item.campaignId, adsetId: item.adsetId,
      changeKind: "config_change", changes: [{ field: "daily_budget", old: item.before.dailyBudget, new: item.target.dailyBudget }],
      actorEmail: actor.email, note, occurredAt, appliedToMeta, errorMessage,
    });
    if (event.ok && event.event) await recordInternalChangeEvent(event.event);
  } catch (error) {
    // A mudança já está na conta do cliente; a falha de registro não pode esconder isso.
    console.error("[meta-batch] falha ao registrar auditoria", item.level, item.id, error);
  }
}

/** Por que um lote não pôde ser assumido para execução. */
function refusal(row: MetaAdsBatch | undefined, actor: BackofficeActor): string {
  if (!row || row.actorId !== actor.id) return "Lote não encontrado (só quem gerou a prévia pode confirmar).";
  if (row.status === "done") return "Este lote já foi executado. Use get_meta_batch para ver o resultado.";
  if (row.status === "running") return "Este lote está em execução agora. Use get_meta_batch em instantes.";
  if (row.status === "previewed") return "A prévia venceu (vale 15 minutos). Gere outra com preview_meta_batch.";
  return "O lote ficou parado por mais de 1 hora. Gere outra prévia com preview_meta_batch.";
}

export async function confirmMetaBatch(actor: BackofficeActor, batchId: string) {
  const b = metaAdsBatch;
  // Assume o lote numa única escrita: prévia válida, lote parcial recente ou execução abandonada
  // (lease vencida). Duas confirmações simultâneas nunca rodam o mesmo lote.
  const [claimed] = await db.update(b)
    .set({ status: "running", leaseUntil: sql`now() + interval '150 seconds'`, confirmedAt: sql`coalesce(${b.confirmedAt}, now())` })
    .where(and(eq(b.id, batchId), eq(b.actorId, actor.id), sql`(
      (${b.status} = 'previewed' AND ${b.expiresAt} > now())
      OR (${b.status} = 'partial' AND ${b.confirmedAt} > now() - interval '1 hour')
      OR (${b.status} = 'running' AND ${b.leaseUntil} < now() AND ${b.confirmedAt} > now() - interval '1 hour')
    )`))
    .returning();
  if (!claimed) {
    const [row] = await db.select().from(b).where(eq(b.id, batchId)).limit(1);
    throw new Error(refusal(row, actor));
  }

  const items = claimed.items as unknown as PlannedItem[];
  const deadline = Date.now() + RUN_BUDGET_MS;
  const save = () => db.update(b).set({ items: items as unknown as Record<string, unknown>[] }).where(eq(b.id, batchId));

  await inGroups(groupByClient(pendingItems(items)), CLIENTS_IN_PARALLEL, async ([userId, entries]) => {
    if (Date.now() > deadline) return;
    const failAll = async (error: string) => {
      for (const item of entries) Object.assign(item, { outcome: "failed", error });
      await save();
    };
    // A carteira pode ter mudado desde a prévia.
    if (!canAccessMarketingUser(actor, userId)) return failAll("O cliente saiu da sua carteira.");
    const token = await getUserAccessTokenByUserId(userId);
    if (!token.success) return failAll(`Sem acesso à Meta deste cliente: ${token.error.message}`);
    let current: Map<string, MetaObjectState>;
    try {
      current = await readItems(token.accessToken, entries);
    } catch (error) {
      return failAll(`Não foi possível reler a Meta deste cliente: ${errorText(error)}`);
    }

    for (const item of entries) {
      if (Date.now() > deadline) break;
      const decision = decideAtConfirm(item, current.get(objectKey(item)));
      if (decision === "missing") {
        Object.assign(item, { outcome: "failed", error: "Não encontrado na Meta na hora de executar." });
      } else if (decision !== "write") {
        item.outcome = decision;
      } else {
        try {
          await metaWrite({ method: "POST", path: item.id, params: "", body: writeBody(item), accessToken: token.accessToken });
          item.outcome = "applied";
          await audit(actor, claimed, item, true);
        } catch (error) {
          Object.assign(item, { outcome: "failed", error: errorText(error) });
          await audit(actor, claimed, item, false, item.error);
        }
      }
      await save();
    }
  });

  const status = batchStatusAfterRun(items);
  const [row] = await db.update(b)
    .set({ items: items as unknown as Record<string, unknown>[], status, leaseUntil: null, finishedAt: status === "done" ? new Date() : null })
    .where(eq(b.id, batchId))
    .returning();
  const described = await describeBatch(row, items);
  return status === "done"
    ? described
    : { ...described, next: `O tempo desta chamada acabou com ${described.summary.pending} item(ns) pendente(s). Chame confirm_meta_batch de novo com o mesmo batchId para continuar.` };
}

export async function getMetaBatch(actor: BackofficeActor, batchId: string) {
  const [row] = await db.select().from(metaAdsBatch).where(eq(metaAdsBatch.id, batchId)).limit(1);
  if (!row || (row.actorId !== actor.id && actor.role !== "admin")) throw new Error("Lote não encontrado.");
  return describeBatch(row, row.items as unknown as PlannedItem[]);
}
