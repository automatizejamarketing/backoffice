import "server-only";

import { and, eq, gte, inArray, like, lt, sql } from "drizzle-orm";
import { canAccessMarketingUser, type BackofficeActor } from "@/lib/auth/rbac-core";
import { recordStatusChangeAudit } from "@/lib/backoffice/meta-status-change-audit";
import { db } from "@/lib/db";
import { createAdSetEditLog, createCampaignEditLog } from "@/lib/db/admin-queries";
import { recordInternalChangeEvent } from "@/lib/db/meta-tracking-event-queries";
import { metaAdsBatch, metaTrackingAccountCoverage, metaTrackingChangeEvent, type MetaAdsBatch } from "@/lib/db/schema";
import { metaApiCall } from "@/lib/meta-business/api";
import { GraphApiError, MetaTokenInvalidError } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import { mapErrorKind } from "@/lib/meta-business/insights/envelope";
import { isRetryableMetaThrottle } from "@/lib/meta-business/write-retry";
import { buildInternalChangeEvent } from "@/lib/meta-tracking/internal-change-event";
import { enterMetaMutationLog, updateMetaMutationContext } from "@/lib/observability/meta-log-context";
import { loadClientLabels } from "./meta-ads-queries";
import {
  actId, auditPendingItems, batchStatusAfterRun, decideAtRun, describeItem, objectKey, pendingItems, planItem, writeBody,
  type BatchItemInput, type BatchLevel, type ClientAccounts, type MetaObjectState, type PlannedItem,
} from "./meta-batch-core";

/**
 * Lote de ações em Meta Ads: o MCP prepara a prévia (lê a Meta e guarda o plano) e devolve
 * um link; a pessoa abre o backoffice, revisa e aprova — e é essa aprovação, na sessão dela
 * no navegador, que executa o plano. A IA nunca executa sozinha. Escreve com o token do
 * próprio cliente, como as telas do backoffice, e registra cada mudança no mesmo histórico.
 */

/** A prévia vale 15 minutos; um lote interrompido pode continuar por 1 hora depois da aprovação. */
const PREVIEW_TTL_MS = 15 * 60 * 1000;
/**
 * Orçamento de tempo da execução, contra o maxDuration de 300 s da rota: itens só começam até
 * 150 s; nenhuma escrita começa depois de 200 s; cada leitura tem 20 s e cada escrita até 80 s
 * (o retry de objeto ocupado da Meta fica dentro disso). Sobra margem para gravar o resultado.
 */
const START_BUDGET_MS = 150_000;
const WRITE_BUDGET_MS = 200_000;
const READ_TIMEOUT_MS = 20_000;
const WRITE_TIMEOUT_MS = 80_000;
/** Maior que o maxDuration: uma execução viva nunca perde a vez; a morta libera em 330 s. */
const LEASE_SQL = sql`now() + interval '330 seconds'`;
/** Clientes em paralelo; dentro de um cliente (um token), uma escrita por vez. */
const CLIENTS_IN_PARALLEL = 3;
/** Contas vistas na coleta dos últimos 90 dias definem quem mais "é dono" de uma conta. */
const OWNERSHIP_WINDOW_DAYS = 90;

/**
 * Campos por nível. Cada lista tem um campo que só existe naquele tipo de objeto (objective,
 * optimization_goal, creative): um id de conjunto pedido como campanha falha na leitura e o
 * item é pulado, em vez de ser tratado e auditado no nível errado.
 */
const FIELDS: Record<BatchLevel, string> = {
  campaign: "id,name,status,effective_status,account_id,daily_budget,lifetime_budget,objective",
  adset: "id,name,status,effective_status,account_id,campaign_id,daily_budget,lifetime_budget,optimization_goal,campaign{daily_budget,lifetime_budget}",
  ad: "id,name,status,effective_status,account_id,campaign_id,adset_id,creative{id}",
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

const graphCode = (error: unknown) => (error instanceof GraphApiError ? error.errorReturn.data?.code : undefined);

/** Limite da Meta ou token inválido: vale para o cliente inteiro, não para um objeto. Pausa e deixa retomar. */
const isClientWideError = (error: unknown) =>
  isRetryableMetaThrottle(error) || graphCode(error) === 190 || error instanceof MetaTokenInvalidError || error instanceof TimedOut;

/**
 * A Meta respondeu e recusou (4xx com código). Qualquer outra falha — conexão caída, 5xx, HTML,
 * tempo esgotado — deixa o resultado de uma escrita DESCONHECIDO: a Meta pode ter aplicado.
 */
const isExplicitRefusal = (error: unknown) =>
  error instanceof GraphApiError && graphCode(error) != null && error.errorReturn.statusCode >= 400 && error.errorReturn.statusCode < 500;

class TimedOut extends Error {}

/** Não cancela a chamada (metaApiCall não aceita sinal), mas devolve o controle a tempo. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new TimedOut(`a Meta não respondeu em ${Math.round(ms / 1000)} s`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** Erro de objeto (não existe, sem acesso, campo de outro tipo): só esse item. */
const isObjectError = (error: unknown) => [100, 10, 200, 803].includes(graphCode(error) ?? -1);

class ClientPaused extends Error {}

const pausedRead = (error: unknown) =>
  `a Meta limitou ou não respondeu às leituras agora (${errorText(error)}). Os itens deste cliente ficaram pendentes; continue em alguns minutos.`;

/**
 * Lê objetos de um nível, 50 por chamada (`?ids=`). Um id sem acesso derruba a leitura múltipla
 * inteira, então nesse caso (e só nesse) cai para um a um. Limite da Meta ou token inválido
 * sobem como ClientPaused, sem disparar mais chamadas.
 */
async function readObjects(accessToken: string, level: BatchLevel, ids: string[]): Promise<Map<string, MetaObjectState>> {
  const found = new Map<string, MetaObjectState>();
  const fields = `fields=${encodeURIComponent(FIELDS[level])}`;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const res = await withTimeout(metaApiCall<Record<string, RawObject>>({ method: "GET", path: "", params: `ids=${chunk.join(",")}&${fields}`, accessToken }), READ_TIMEOUT_MS);
      for (const raw of Object.values(res)) if (raw?.id) found.set(raw.id, normalize(raw));
    } catch (error) {
      if (!isObjectError(error)) throw isClientWideError(error) ? new ClientPaused(pausedRead(error)) : error;
      for (const id of chunk) {
        const object = await readOne(accessToken, level, id);
        if (object) found.set(id, object);
      }
    }
  }
  return found;
}

async function readOne(accessToken: string, level: BatchLevel, id: string): Promise<MetaObjectState | undefined> {
  try {
    return normalize(await withTimeout(metaApiCall<RawObject>({ method: "GET", path: id, params: `fields=${encodeURIComponent(FIELDS[level])}`, accessToken }), READ_TIMEOUT_MS));
  } catch (error) {
    if (isObjectError(error)) return undefined;
    throw isClientWideError(error) ? new ClientPaused(pausedRead(error)) : error;
  }
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

/**
 * Contas que também aparecem, na coleta recente, em algum cliente que quem pede não acompanha.
 * Uma conexão de agência enxerga contas de outros negócios: sem isto, um consultor pausaria a
 * campanha de um cliente fora da carteira passando o id de um cliente dele.
 */
async function sharedOutsidePortfolio(actor: BackofficeActor, accountIds: string[]): Promise<Set<string>> {
  if (accountIds.length === 0) return new Set();
  const c = metaTrackingAccountCoverage;
  const since = new Date(Date.now() - OWNERSHIP_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .selectDistinct({ accountId: c.accountId, userId: c.userId })
    .from(c)
    .where(and(inArray(c.accountId, accountIds), gte(c.businessDate, since)));
  return new Set(rows.filter(r => !canAccessMarketingUser(actor, r.userId)).map(r => r.accountId));
}

async function inGroups<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(run));
}

function groupByClient<T extends { userId: string }>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.userId, [...(groups.get(item.userId) ?? []), item]);
  return [...groups];
}

/**
 * O que a tela oferece para o lote, pelas mesmas regras com que runMetaBatch o assume: aprovar
 * uma prévia válida, continuar um lote parcial (ou uma execução que morreu) de até 1 hora.
 */
export function batchAction(row: Pick<MetaAdsBatch, "status" | "expiresAt" | "confirmedAt" | "leaseUntil">, now = Date.now()): "approve" | "resume" | null {
  if (row.status === "previewed") return row.expiresAt.getTime() > now ? "approve" : null;
  const recent = row.confirmedAt != null && row.confirmedAt.getTime() > now - 60 * 60 * 1000;
  const abandoned = row.status === "running" && row.leaseUntil != null && row.leaseUntil.getTime() < now;
  return recent && (row.status === "partial" || abandoned) ? "resume" : null;
}

export const approvalUrl = (origin: string, batchId: string) => `${origin.replace(/\/$/, "")}/lotes/${batchId}`;

export async function describeBatch(row: Pick<MetaAdsBatch, "id" | "status" | "note" | "expiresAt" | "confirmedAt" | "finishedAt">, items: PlannedItem[]) {
  const labels = await loadClientLabels([...new Set(items.map(i => i.userId))]);
  const count = (predicate: (i: PlannedItem) => boolean) => items.filter(predicate).length;
  return {
    batchId: row.id,
    status: row.status,
    note: row.note,
    expiresAt: row.status === "previewed" ? row.expiresAt.toISOString() : undefined,
    approvedAt: row.confirmedAt?.toISOString(),
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
      auditPending: auditPendingItems(items).length,
    },
    items: items.map((item, index) => describeItem(item, index, labels.get(item.userId)?.client ?? item.userId)),
  };
}

function requireDatabaseActor(actor: BackofficeActor) {
  // Admin só da allowlist não tem linha em backoffice_users: o lote precisa de um dono real.
  if (actor.source !== "database") throw new Error("Cadastre seu usuário na Equipe do backoffice para usar ações em lote.");
}

export async function previewMetaBatch(actor: BackofficeActor, input: { items: BatchItemInput[]; note: string }, origin: string) {
  requireDatabaseActor(actor);
  const outside = [...new Set(input.items.map(i => i.userId))].filter(userId => !canAccessMarketingUser(actor, userId));
  if (outside.length) throw new Error(`Fora da sua carteira: ${outside.join(", ")}.`);
  const keys = input.items.map(objectKey);
  const repeated = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (repeated.length) throw new Error(`O mesmo objeto aparece mais de uma vez: ${[...new Set(repeated)].join(", ")}.`);

  const planned: PlannedItem[] = new Array(input.items.length);
  const indexed = input.items.map((item, index) => ({ ...item, index }));
  await inGroups(groupByClient(indexed), CLIENTS_IN_PARALLEL, async ([userId, entries]) => {
    let failure: string | null = null;
    let accounts: ClientAccounts = { allowed: new Map(), shared: new Set(), listed: false };
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
        const visible = new Map((profile.adaccounts?.data ?? []).map(a => [actId(a.account_id ?? a.id)!, a.currency ?? null]));
        accounts = { allowed: visible, shared: await sharedOutsidePortfolio(actor, [...visible.keys()]), listed: visible.size > 0 };
        objects = await readItems(token.accessToken, entries);
      }
    } catch (error) {
      failure = error instanceof ClientPaused
        ? `Não deu para ler este cliente: ${error.message.replace(/continue em alguns minutos\.$/, "gere a prévia de novo em alguns minutos.")}`
        : `Não foi possível ler a Meta deste cliente: ${errorText(error)}`;
    }
    for (const { index, ...item } of entries) {
      const plan = planItem(item, objects.get(objectKey(item)), accounts);
      planned[index] = failure ? { ...plan, plan: "skip", skipReason: failure, warning: undefined } : plan;
    }
  });

  // Prévias vencidas há mais de um dia não servem para nada: limpa as desta pessoa.
  await db.delete(metaAdsBatch).where(and(
    eq(metaAdsBatch.actorId, actor.id), eq(metaAdsBatch.status, "previewed"), lt(metaAdsBatch.expiresAt, sql`now() - interval '1 day'`),
  ));

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
  if (!row) return { ...described, batchId: null, expiresAt: undefined, next: "Nada a executar: todos os itens foram pulados (veja o motivo de cada um)." };
  return {
    ...described,
    approvalUrl: approvalUrl(origin, row.id),
    next:
      "Nada mudou na Meta ainda. Mostre o resumo ao usuário (itens, avisos e pulados) e envie o approvalUrl: ele abre o backoffice, revisa e clica em Aprovar e executar. " +
      "Depois use get_meta_batch com este batchId para ver o resultado. A prévia vale 15 minutos.",
  };
}

/** Marca única de um item no histórico: é como a retomada sabe que o registro já foi feito. */
const auditMarker = (batchId: string, index: number) => `[lote ${batchId} #${index + 1} via MCP]`;

/**
 * Registra a mudança no histórico, uma vez por item: se a execução morreu depois de registrar e
 * antes de marcar `audit: "done"`, a retomada acha o evento pela marca e não registra de novo.
 * O evento é o último registro gravado, então achá-lo significa que o resto também foi.
 */
async function audit(actor: BackofficeActor, batch: { id: string; note: string }, index: number, item: PlannedItem, appliedToMeta: boolean, errorMessage?: string): Promise<boolean> {
  const marker = auditMarker(batch.id, index);
  const note = `${batch.note} ${marker}`;
  const occurredAt = new Date();
  const accountId = item.accountId!;
  try {
    const e = metaTrackingChangeEvent;
    const [existing] = await db.select({ id: e.id }).from(e).where(and(eq(e.entityId, item.id), like(e.note, `%${marker}`))).limit(1);
    if (existing) return true;
    if (item.target.status) {
      const result = await recordStatusChangeAudit({
        entity: item.level, backofficeUserEmail: actor.email, targetUserId: item.userId, accountId,
        objectId: item.id, objectName: item.name, campaignId: item.campaignId, adsetId: item.adsetId,
        previousStatus: item.before.status, newStatus: item.target.status, note, occurredAt, appliedToMeta, errorMessage,
      });
      return !result.auditLogFailed;
    }
    // Orçamento: o log legado (é o que as abas de histórico das telas leem) + o evento no stream, com a ponte.
    const log = item.level === "campaign"
      ? await createCampaignEditLog({
        backofficeUserEmail: actor.email, targetUserId: item.userId, campaignId: item.id, accountId, campaignName: item.name ?? undefined,
        previousBudgetMode: "CBO", newBudgetMode: "CBO", previousDailyBudget: item.before.dailyBudget, newDailyBudget: item.target.dailyBudget,
        note, appliedToMeta, errorMessage,
      })
      : await createAdSetEditLog({
        backofficeUserEmail: actor.email, targetUserId: item.userId, adsetId: item.id, accountId, campaignId: item.campaignId ?? undefined,
        adsetName: item.name ?? undefined, previousDailyBudget: item.before.dailyBudget ?? undefined, newDailyBudget: item.target.dailyBudget,
        note, appliedToMeta, errorMessage,
      });
    const event = buildInternalChangeEvent({
      source: "backoffice_admin", userId: item.userId, accountId, entityLevel: item.level,
      entityId: item.id, entityName: item.name, campaignId: item.campaignId, adsetId: item.adsetId,
      changeKind: "config_change", changes: [{ field: "daily_budget", old: item.before.dailyBudget, new: item.target.dailyBudget }],
      actorEmail: actor.email, note, occurredAt, appliedToMeta, errorMessage,
      legacy: log?.id ? { table: item.level === "campaign" ? "campaign_edit_logs" : "adset_edit_logs", id: log.id } : null,
    });
    const eventId = event.ok && event.event ? await recordInternalChangeEvent(event.event) : null;
    return Boolean(log?.id) && Boolean(eventId);
  } catch (error) {
    // A mudança já está na conta do cliente; a falha de registro fica marcada e é refeita na retomada.
    console.error("[meta-batch] falha ao registrar auditoria", item.level, item.id, error);
    return false;
  }
}

/** Por que um lote não pôde ser assumido para execução. */
function refusal(row: MetaAdsBatch | undefined, actor: BackofficeActor): string {
  if (!row || row.actorId !== actor.id) return "Lote não encontrado (só quem gerou a prévia aprova).";
  if (row.status === "done") return "Este lote já foi executado.";
  const stale = row.confirmedAt && row.confirmedAt.getTime() < Date.now() - 60 * 60 * 1000;
  if (stale) return "O lote ficou parado por mais de 1 hora. Gere outra prévia.";
  if (row.status === "running") return "Este lote está em execução agora. Atualize em instantes.";
  return "A prévia venceu (vale 15 minutos). Gere outra.";
}

class LostLease extends Error {}

/**
 * Executa (ou continua) um lote. Chamado só pela aprovação no backoffice, com a sessão da
 * pessoa no navegador. Cada execução assume o lote com um `run_id` novo; toda gravação é
 * condicionada a ele, então uma execução antiga que perdeu a vez para antes da próxima escrita
 * e não registra nada em duplicidade.
 */
export async function runMetaBatch(actor: BackofficeActor, batchId: string) {
  requireDatabaseActor(actor);
  const b = metaAdsBatch;
  const [claimed] = await db.update(b)
    .set({ status: "running", runId: sql`gen_random_uuid()`, leaseUntil: LEASE_SQL, confirmedAt: sql`coalesce(${b.confirmedAt}, now())` })
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

  enterMetaMutationLog({ app: "backoffice", route: `POST /api/meta-batches/{id}/run (lote ${batchId})`, operationHint: "update" });

  const runId = claimed.runId!;
  const items = claimed.items as unknown as PlannedItem[];
  const startedAt = Date.now();
  const notes: string[] = [];
  let lost = false;

  /** Grava um item (só o índice dele) e renova a vez desta execução. */
  const saveItem = async (index: number) => {
    const updated = await db.update(b)
      .set({ items: sql`jsonb_set(${b.items}, ${`{${index}}`}::text[], ${JSON.stringify(items[index])}::jsonb)`, leaseUntil: LEASE_SQL })
      .where(and(eq(b.id, batchId), eq(b.runId, runId)))
      .returning({ id: b.id });
    if (updated.length === 0) {
      lost = true;
      throw new LostLease();
    }
  };

  const work = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (item.plan === "run" && !item.outcome) || (item.outcome === "applied" && item.audit !== "done"));

  await inGroups(groupByClient(work.map(w => ({ ...w, userId: w.item.userId }))), CLIENTS_IN_PARALLEL, async ([userId, entries]) => {
    try {
      if (lost || Date.now() - startedAt > START_BUDGET_MS) return;
      updateMetaMutationContext({ actor: { kind: "backoffice", id: actor.id, email: actor.email, role: actor.role, targetUserId: userId } });
      // Registro que ficou para trás numa execução anterior: refaz antes de qualquer escrita nova.
      for (const { item, index } of entries.filter(e => e.item.outcome === "applied")) {
        item.audit = (await audit(actor, claimed, index, item, true)) ? "done" : "failed";
        await saveItem(index);
      }
      const toRun = entries.filter(e => !e.item.outcome);
      if (toRun.length === 0) return;
      // A carteira pode ter mudado desde a prévia.
      if (!canAccessMarketingUser(actor, userId)) {
        for (const { item, index } of toRun) { Object.assign(item, { outcome: "failed", error: "O cliente saiu da sua carteira." }); await saveItem(index); }
        return;
      }
      const token = await getUserAccessTokenByUserId(userId);
      if (!token.success) {
        for (const { item, index } of toRun) { Object.assign(item, { outcome: "failed", error: `Sem acesso à Meta deste cliente: ${token.error.message}` }); await saveItem(index); }
        return;
      }
      const shared = await sharedOutsidePortfolio(actor, [...new Set(toRun.map(e => e.item.accountId!))]);

      for (const { item, index } of toRun) {
        if (lost || Date.now() - startedAt > START_BUDGET_MS) return;
        if (shared.has(item.accountId!)) {
          Object.assign(item, { outcome: "failed", error: "A conta de anúncio passou a ser também de um cliente fora da sua carteira." });
          await saveItem(index);
          continue;
        }
        // Relê ESTE objeto agora, logo antes de escrever: nada lido no começo da execução vale aqui.
        const decision = decideAtRun(item, await readOne(token.accessToken, item.level, item.id));
        if (decision === "missing") {
          Object.assign(item, { outcome: "failed", error: "Não encontrado na Meta na hora de executar." });
        } else if (decision === "applied") {
          item.outcome = "applied";
          await saveItem(index);
          item.audit = (await audit(actor, claimed, index, item, true)) ? "done" : "failed";
        } else if (decision !== "write") {
          item.outcome = decision;
        } else {
          // A releitura pode ter demorado: sem tempo para escrever e gravar, o item fica para Continuar.
          if (Date.now() - startedAt > WRITE_BUDGET_MS) return;
          item.attempt = "writing";
          await saveItem(index);
          let uncertain: string | null = null;
          try {
            // Sem retry de throttle aqui: um limite da Meta pausa o cliente e o lote continua depois.
            await withTimeout(metaApiCall({ method: "POST", path: item.id, params: "", body: writeBody(item), accessToken: token.accessToken }), WRITE_TIMEOUT_MS);
          } catch (error) {
            if (isClientWideError(error) && !(error instanceof TimedOut)) {
              // Limite ou token: a Meta recusou, nada foi aplicado.
              item.attempt = undefined;
              await saveItem(index);
              throw new ClientPaused(`a Meta limitou as chamadas agora (${errorText(error)}). Os itens deste cliente ficaram pendentes; continue em alguns minutos.`);
            }
            if (isExplicitRefusal(error)) {
              Object.assign(item, { outcome: "failed", error: errorText(error), attempt: undefined });
              await saveItem(index);
              await audit(actor, claimed, index, item, false, item.error);
              continue;
            }
            uncertain = errorText(error);
          }
          if (uncertain) {
            // Conexão caída ou tempo esgotado: a Meta pode ter aplicado. Relê para saber; se não der,
            // o item fica pendente COM a marca e a retomada decide pela releitura.
            const now = await readOne(token.accessToken, item.level, item.id).catch(() => undefined);
            if (decideAtRun(item, now) !== "applied") {
              throw new ClientPaused(`não deu para confirmar se a Meta aplicou a mudança em ${item.name ?? item.id} (${uncertain}). Continue para conferir e seguir.`);
            }
          }
          item.outcome = "applied";
          // Grava o resultado ANTES do registro: se esta execução perdeu a vez, para aqui e a
          // que assumiu reconhece a escrita (attempt) e registra uma vez só.
          await saveItem(index);
          item.audit = (await audit(actor, claimed, index, item, true)) ? "done" : "failed";
        }
        await saveItem(index);
      }
    } catch (error) {
      if (error instanceof LostLease) return;
      const client = (await loadClientLabels([userId])).get(userId)?.client ?? userId;
      notes.push(error instanceof ClientPaused
        ? `${client}: ${error.message}`
        : `${client}: a execução parou por um erro (${errorText(error)}). Os itens restantes ficaram pendentes.`);
    }
  });

  if (lost) throw new Error("Outra execução assumiu este lote. Atualize a página para ver o resultado.");
  // A conclusão vem do que está gravado, não da memória: um item que falhou ao gravar continua pendente.
  const [persisted] = await db.select({ items: b.items }).from(b).where(and(eq(b.id, batchId), eq(b.runId, runId))).limit(1);
  if (!persisted) throw new Error("Outra execução assumiu este lote. Atualize a página para ver o resultado.");
  const saved = persisted.items as unknown as PlannedItem[];
  const status = batchStatusAfterRun(saved) === "done" && auditPendingItems(saved).length === 0 ? "done" : "partial";
  const [row] = await db.update(b)
    .set({ status, leaseUntil: null, runId: null, finishedAt: status === "done" ? new Date() : null })
    .where(and(eq(b.id, batchId), eq(b.runId, runId)))
    .returning();
  if (!row) throw new Error("Outra execução assumiu este lote. Atualize a página para ver o resultado.");
  const described = await describeBatch(row, row.items as unknown as PlannedItem[]);
  return status === "done" ? { ...described, notes } : { ...described, notes: [...notes, "Ficaram itens pendentes: use Continuar para seguir de onde parou."] };
}

export async function getMetaBatch(actor: BackofficeActor, batchId: string) {
  const [row] = await db.select().from(metaAdsBatch).where(eq(metaAdsBatch.id, batchId)).limit(1);
  if (!row || (row.actorId !== actor.id && actor.role !== "admin")) throw new Error("Lote não encontrado.");
  return { row, described: await describeBatch(row, row.items as unknown as PlannedItem[]) };
}
