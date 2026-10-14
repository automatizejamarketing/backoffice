import "server-only";

import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agencyClient,
  clickupConnection,
  clickupOutbox,
  clickupTaskPost,
  clickupWebhookEvent,
  instagramAccount,
  scheduledPost,
} from "@/lib/db/schema";
import { decryptAccessToken } from "@/lib/meta-business/token-vault";
import {
  ClickupApiError,
  ClickupAuthError,
  ClickupRateLimitError,
  getListTaskIdsInStatus,
  getTask,
  getWebhooks,
  postComment,
  reactivateWebhook,
  setTaskStatus,
} from "./api";
import {
  decideTask,
  feedback,
  isOwnEcho,
  statusChanges,
  statusIntent,
  verifySignature,
  type ClickupMapping,
  type ClientReadiness,
} from "./core";
import { copyTaskMedia, MediaError } from "./media";

/**
 * Postagem pelo ClickUp (ADR 0043/0045). O webhook só registra o evento (deduplicado) e responde;
 * `processEvent` relê a tarefa e cria, atualiza ou cancela o Agendamento Sincronizado na conta do
 * cliente; o retorno na tarefa sai pela fila `clickup_outbox`, que retenta sem bloquear a publicação.
 */

export const MAX_EVENT_ATTEMPTS = 5;
const MAX_OUTBOX_ATTEMPTS = 8;
const OUTBOX_BACKOFF_MIN = [1, 2, 5, 15, 30, 60, 120, 240];

type Connection = typeof clickupConnection.$inferSelect;

export const tokenOf = (connection: Pick<Connection, "accessTokenEncrypted">) => decryptAccessToken(connection.accessTokenEncrypted);
const mappingOf = (connection: Connection) => connection.mapping as ClickupMapping | null;

export async function getConnection(agencyId: string): Promise<Connection | null> {
  const [row] = await db.select().from(clickupConnection).where(eq(clickupConnection.agencyId, agencyId)).limit(1);
  return row ?? null;
}

async function markNeedsReconnect(agencyId: string, detail: string) {
  await db
    .update(clickupConnection)
    .set({ status: "needs_reconnect", statusDetail: detail, updatedAt: new Date() })
    .where(eq(clickupConnection.agencyId, agencyId));
}

// ---------------------------------------------------------------- webhook

export type WebhookOutcome = { status: number; newEventIds: string[] };

/**
 * Registra os eventos de um POST do webhook. Assinatura inválida responde 400 (nunca 401/410: o
 * ClickUp suspende o webhook na hora com esses). Eco das nossas próprias escritas é descartado.
 */
export async function recordWebhook(agencyId: string, rawBody: string, signature: string | null): Promise<WebhookOutcome> {
  const connection = await getConnection(agencyId);
  if (!connection?.webhookSecretEncrypted || !connection.mapping) return { status: 200, newEventIds: [] };
  if (!verifySignature(rawBody, signature, decryptAccessToken(connection.webhookSecretEncrypted))) return { status: 400, newEventIds: [] };
  let payload: { webhook_id?: unknown; task_id?: unknown; history_items?: unknown };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, newEventIds: [] };
  }
  if (payload.webhook_id !== connection.webhookId) return { status: 200, newEventIds: [] };
  const mapping = mappingOf(connection)!;
  const changes = statusChanges(payload);
  if (!changes.length) return { status: 200, newEventIds: [] };

  // Escritas de status nossas (enviadas ou na fila): o webhook pode chegar antes de gravarmos o envio.
  const ownWrites = await db
    .select({ taskId: clickupOutbox.taskId, status: clickupOutbox.body, sentAt: clickupOutbox.sentAt, createdAt: clickupOutbox.createdAt })
    .from(clickupOutbox)
    .where(and(eq(clickupOutbox.agencyId, agencyId), eq(clickupOutbox.kind, "status"), eq(clickupOutbox.taskId, changes[0]!.taskId), gt(clickupOutbox.createdAt, new Date(Date.now() - 30 * 60_000))));
  const writes = ownWrites.map((w) => ({ taskId: w.taskId, status: w.status, at: w.sentAt ?? w.createdAt }));

  const rows = changes.flatMap((change) => {
    const intent = statusIntent(change, mapping.statuses);
    if (!intent || isOwnEcho(change, writes)) return [];
    return [{ id: `${connection.webhookId}:${change.historyId}`, agencyId, taskId: change.taskId, intent, actorClickupUserId: change.userId, toStatus: change.to }];
  });
  if (!rows.length) return { status: 200, newEventIds: [] };
  // A pessoa tirou a tarefa da Aprovação/Agendado: um "Agendado" nosso ainda na fila não pode desfazer isso.
  for (const row of rows) if (row.intent === "cancel") await supersedeStatusWrites(row.taskId);
  const inserted = await db.insert(clickupWebhookEvent).values(rows).onConflictDoNothing().returning({ id: clickupWebhookEvent.id });
  return { status: 200, newEventIds: inserted.map((r) => r.id) };
}

// ---------------------------------------------------------------- processing

/** Conta pronta: ainda é cliente desta agência e tem Instagram conectado sem reconexão pendente. */
async function readinessFor(agencyId: string, userIds: string[]): Promise<(userId: string) => ClientReadiness> {
  if (!userIds.length) return () => ({ ready: false, reason: "Cliente não encontrado." });
  const [clients, accounts] = await Promise.all([
    db.select({ userId: agencyClient.userId }).from(agencyClient).where(and(eq(agencyClient.agencyId, agencyId), inArray(agencyClient.userId, userIds))),
    db
      .select({ userId: instagramAccount.userId, username: instagramAccount.username, needsReconnectAt: instagramAccount.needsReconnectAt })
      .from(instagramAccount)
      .where(and(inArray(instagramAccount.userId, userIds), isNull(instagramAccount.deletedAt)))
      .orderBy(asc(instagramAccount.createdAt)),
  ]);
  const inAgency = new Set(clients.map((c) => c.userId));
  return (userId) => {
    if (!inAgency.has(userId)) return { ready: false, reason: "Este cliente não é mais da agência no Automatize." };
    // O cron de publicação usa a primeira conta do cliente; a checagem olha a mesma.
    const account = accounts.find((a) => a.userId === userId);
    if (!account) return { ready: false, reason: "O cliente ainda não conectou o Instagram no Automatize." };
    if (account.needsReconnectAt) return { ready: false, reason: "O Instagram do cliente precisa ser reconectado no Automatize." };
    return { ready: true, instagramUsername: account.username ?? "conta" };
  };
}

const OUTBOX_SUPERSEDED = "superado por uma escrita mais nova";

/** Status ainda não enviado de uma tarefa deixa de valer: o mais novo manda. */
async function supersedeStatusWrites(taskId: string) {
  await db
    .update(clickupOutbox)
    .set({ attempts: MAX_OUTBOX_ATTEMPTS, lastError: OUTBOX_SUPERSEDED })
    .where(and(eq(clickupOutbox.taskId, taskId), eq(clickupOutbox.kind, "status"), isNull(clickupOutbox.sentAt)));
}

async function enqueue(
  agencyId: string,
  taskId: string,
  items: Array<{ kind: "comment" | "status"; key: string; body: string; mention?: string | null }>,
) {
  if (!items.length) return;
  if (items.some((i) => i.kind === "status")) await supersedeStatusWrites(taskId);
  await db
    .insert(clickupOutbox)
    .values(items.map((i) => ({ agencyId, taskId, kind: i.kind, dedupeKey: i.key, body: i.body, mentionClickupUserId: i.mention ?? null })))
    .onConflictDoNothing();
}

/** Recusa: comentário com o que falta (menciona quem aprovou) e, se houver, Status de Erro. */
async function refuse(agencyId: string, mapping: ClickupMapping, eventId: string, taskId: string, reasons: string[], approver: string | null) {
  await enqueue(agencyId, taskId, [
    { kind: "comment", key: `refuse:${eventId}`, body: feedback.refused(reasons), mention: approver },
    ...(mapping.statuses.error ? [{ kind: "status" as const, key: `refuse-status:${eventId}`, body: mapping.statuses.error }] : []),
  ]);
}

type Event = typeof clickupWebhookEvent.$inferSelect;

const LOCK_MS = 5 * 60_000;
const RETRY_MS = 60_000;

/**
 * Solta a trava para o cron tentar de novo daqui a pouco. `uncounted`: a falha não é do evento
 * (conexão a reconectar, limite do ClickUp), então a tentativa não conta e ele não se perde.
 */
const EVENT_BACKOFF_MIN = [1, 2, 5, 15];

async function release(eventId: string, result: string, uncounted = false, retryMs = RETRY_MS) {
  await db
    .update(clickupWebhookEvent)
    .set({
      lockedUntil: new Date(Date.now() + retryMs),
      result,
      ...(uncounted ? { attempts: sql`greatest(${clickupWebhookEvent.attempts} - 1, 0)` } : {}),
    })
    .where(eq(clickupWebhookEvent.id, eventId));
}

class ConnectionInactive extends Error {}

/**
 * Reivindica o evento com trava (o `after()` do webhook e o cron podem chegar juntos) e o processa.
 * Devolve o resultado, ou null se outro já está com ele ou ele já terminou.
 */
export async function processEvent(eventId: string, now = new Date()): Promise<string | null> {
  const [event] = await db
    .update(clickupWebhookEvent)
    .set({ attempts: sql`${clickupWebhookEvent.attempts} + 1`, lockedUntil: new Date(Date.now() + LOCK_MS) })
    .where(
      and(
        eq(clickupWebhookEvent.id, eventId),
        isNull(clickupWebhookEvent.processedAt),
        lt(clickupWebhookEvent.attempts, MAX_EVENT_ATTEMPTS),
        or(isNull(clickupWebhookEvent.lockedUntil), lt(clickupWebhookEvent.lockedUntil, sql`now()`)),
      ),
    )
    .returning();
  if (!event) return null;
  try {
    const result = await handleEvent(event, now);
    await finish(event.id, result);
    return result;
  } catch (error) {
    if (error instanceof ClickupAuthError || error instanceof ConnectionInactive) {
      if (error instanceof ClickupAuthError) await markNeedsReconnect(event.agencyId, error.message);
      // Fica esperando a reconexão (que reabre os eventos); não gasta tentativa.
      await release(event.id, "reconectar ClickUp", true);
      return "reconectar ClickUp";
    }
    if (error instanceof ClickupRateLimitError) {
      await release(event.id, "limite do ClickUp", true);
      return "limite do ClickUp; tenta de novo";
    }
    console.error("[clickup] evento", event.id, error);
    if (event.attempts >= MAX_EVENT_ATTEMPTS) {
      const connection = await getConnection(event.agencyId);
      const mapping = connection && mappingOf(connection);
      if (mapping) await refuse(event.agencyId, mapping, event.id, event.taskId, ["Erro interno do Automatize ao agendar. Mova a tarefa de novo para tentar outra vez."], event.actorClickupUserId);
      await finish(event.id, "falhou depois de várias tentativas");
    } else {
      // Espera crescente (1, 2, 5, 15 min): uma instabilidade curta do ClickUp não mata o evento.
      await release(event.id, error instanceof Error ? error.message.slice(0, 300) : "erro", false, EVENT_BACKOFF_MIN[Math.min(event.attempts - 1, EVENT_BACKOFF_MIN.length - 1)]! * 60_000);
    }
    return "erro; tenta de novo";
  }
}

async function finish(eventId: string, result: string) {
  await db.update(clickupWebhookEvent).set({ processedAt: new Date(), result }).where(eq(clickupWebhookEvent.id, eventId));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Uma tarefa por vez: dois eventos da mesma tarefa não deixam dois agendamentos vivos. */
async function lockTask(tx: Tx, taskId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`clickup-task:${taskId}`}))`);
}

/**
 * Agendamento que ainda dá para cancelar ou trocar: o cron de publicação só pega posts com horário
 * vencido e mantém `pending` enquanto chama a Meta, então o status sozinho não basta. Com o horário
 * a 2 min ou mais, o cron não pegou e não vai pegar antes do commit.
 */
export const EDIT_MARGIN_MS = 2 * 60_000;
function editable(scheduledPostId: string) {
  return and(
    eq(scheduledPost.id, scheduledPostId),
    isNull(scheduledPost.deletedAt),
    inArray(scheduledPost.status, ["pending", "retry"]),
    gt(scheduledPost.scheduledAt, new Date(Date.now() + EDIT_MARGIN_MS)),
  );
}

/**
 * Cliente saiu da agência: cancela os agendamentos do ClickUp dele que ainda dá para cancelar. Roda
 * depois de apagar a ligação; um agendamento em processamento termina antes (trava `for share`).
 */
export async function cancelClickupPostsOfClient(agencyId: string, userId: string, now = new Date()) {
  const links = await db
    .select({ taskId: clickupTaskPost.taskId, scheduledPostId: clickupTaskPost.scheduledPostId })
    .from(clickupTaskPost)
    .where(and(eq(clickupTaskPost.agencyId, agencyId), eq(clickupTaskPost.userId, userId), eq(clickupTaskPost.state, "scheduled")));
  for (const link of links) {
    if (!link.scheduledPostId) continue;
    const cancelled = await db.transaction(async (tx) => {
      await lockTask(tx, link.taskId);
      const done = await tx.update(scheduledPost).set({ deletedAt: now, updatedAt: now }).where(editable(link.scheduledPostId!)).returning({ id: scheduledPost.id });
      if (!done.length) return false;
      await tx.update(clickupTaskPost).set({ state: "cancelled", reportedState: "cancelled", updatedAt: now }).where(eq(clickupTaskPost.taskId, link.taskId));
      return true;
    });
    if (cancelled) {
      await supersedeStatusWrites(link.taskId);
      await enqueue(agencyId, link.taskId, [{ kind: "comment", key: `client-removed:${link.taskId}:${link.scheduledPostId}`, body: "Automatize: agendamento cancelado porque o cliente saiu da agência no Automatize." }]);
    }
  }
}

async function handleEvent(event: Event, now: Date): Promise<string> {
  const connection = await getConnection(event.agencyId);
  const mapping = connection && mappingOf(connection);
  if (!connection || !mapping) return "sem conexão";
  if (connection.status !== "active") throw new ConnectionInactive();
  const token = tokenOf(connection);
  const task = await getTask(token, event.taskId);
  if (task.list?.id && task.list.id !== mapping.listId) return "tarefa fora da Lista de Publicação";
  const [link] = await db.select().from(clickupTaskPost).where(eq(clickupTaskPost.taskId, event.taskId)).limit(1);
  const current = task.status.status.trim().toLowerCase();

  if (event.intent === "cancel") {
    if (current === mapping.statuses.approval.trim().toLowerCase()) return "voltou para aprovação";
    // "Agendado" agora pode ser a pessoa voltando atrás ou uma escrita nossa atrasada (enviada depois
    // que a mudança dela chegou). Só a primeira desfaz o cancelamento.
    const ownLateWrite = current === mapping.statuses.scheduled.trim().toLowerCase()
      ? await db
          .select({ id: clickupOutbox.id })
          .from(clickupOutbox)
          .where(and(eq(clickupOutbox.taskId, event.taskId), eq(clickupOutbox.kind, "status"), sql`lower(${clickupOutbox.body}) = ${current}`, gte(clickupOutbox.sentAt, event.receivedAt)))
          .limit(1)
          .then((rows) => rows.length > 0)
      : false;
    if (current === mapping.statuses.scheduled.trim().toLowerCase() && !ownLateWrite) return "voltou para agendado";
    const outcome = await db.transaction(async (tx) => {
      await lockTask(tx, event.taskId);
      const [locked] = await tx.select().from(clickupTaskPost).where(eq(clickupTaskPost.taskId, event.taskId)).limit(1);
      if (!locked?.scheduledPostId || locked.state !== "scheduled") return "nada agendado";
      const cancelled = await tx
        .update(scheduledPost)
        .set({ deletedAt: now, updatedAt: now })
        .where(editable(locked.scheduledPostId))
        .returning({ id: scheduledPost.id });
      if (!cancelled.length) return "tarde demais";
      await tx.update(clickupTaskPost).set({ state: "cancelled", reportedState: "cancelled", updatedAt: now }).where(eq(clickupTaskPost.taskId, event.taskId));
      return "cancelado";
    });
    if (outcome === "tarde demais") {
      await enqueue(event.agencyId, event.taskId, [{ kind: "comment", key: `cancel-late:${event.id}`, body: feedback.tooLateToCancel(), mention: event.actorClickupUserId }]);
      return "já estava em publicação";
    }
    if (outcome === "cancelado") {
      await supersedeStatusWrites(event.taskId);
      await enqueue(event.agencyId, event.taskId, [
        // Nossa escrita atrasada tinha posto a tarefa em "Agendado": devolve ao status que a pessoa escolheu.
        ...(ownLateWrite && event.toStatus ? [{ kind: "status" as const, key: `restore:${event.id}`, body: event.toStatus }] : []),
        { kind: "comment", key: `cancel:${event.id}`, body: feedback.cancelled() },
      ]);
    }
    return outcome;
  }

  // schedule: a tarefa precisa continuar no Status de Aprovação (senão o evento ficou velho).
  if (current !== mapping.statuses.approval.trim().toLowerCase()) return "tarefa já saiu do status de aprovação";
  if (link?.state === "posted") return "já publicado";
  const optionUserIds = Object.values(mapping.clientOptions);
  const readiness = await readinessFor(event.agencyId, optionUserIds);
  const decision = decideTask(task, mapping, readiness, now);
  if (decision.kind === "ignore") return decision.why;
  if (decision.kind === "refuse") {
    await refuse(event.agencyId, mapping, event.id, event.taskId, decision.reasons, event.actorClickupUserId);
    return `recusado: ${decision.reasons.join(" ")}`;
  }

  let stored;
  try {
    stored = await copyTaskMedia({ agencyId: event.agencyId, taskId: event.taskId, media: decision.media, token });
  } catch (error) {
    if (!(error instanceof MediaError)) throw error;
    await refuse(event.agencyId, mapping, event.id, event.taskId, [error.message], event.actorClickupUserId);
    return `recusado: ${error.message}`;
  }

  // A cópia leva segundos: se a aprovação foi retirada nesse meio-tempo, não agenda.
  const fresh = await getTask(token, event.taskId);
  if (fresh.status.status.trim().toLowerCase() !== mapping.statuses.approval.trim().toLowerCase()) {
    return "aprovação retirada durante o processamento";
  }

  const ready = readiness(decision.userId);
  const username = ready.ready ? ready.instagramUsername : "conta";
  const values = {
    userId: decision.userId,
    caption: decision.caption || null,
    scheduledAt: decision.publishAt,
    status: "pending",
    retryAttempts: 0,
    lastErrorMessage: null,
    updatedAt: now,
    ...(decision.format === "reels"
      ? { mediaType: "REELS", mediaUrl: stored[0]!.url, carouselItems: null }
      : stored.length > 1
        ? {
            mediaType: "CAROUSEL_ALBUM",
            mediaUrl: stored[0]!.url,
            carouselItems: stored.map((s) => ({ mediaUrl: s.url, mediaType: "IMAGE" as const, containerId: null, containerStatus: null })),
          }
        : { mediaType: "IMAGE", mediaUrl: stored[0]!.url, carouselItems: null }),
  };

  const outcome = await db.transaction(async (tx) => {
    await lockTask(tx, event.taskId);
    // O cliente continua na agência até o fim da transação (a remoção espera e depois cancela).
    const [stillClient] = await tx.execute<{ ok: number }>(
      sql`select 1 as ok from ${agencyClient} where ${agencyClient.userId} = ${decision.userId} and ${agencyClient.agencyId} = ${event.agencyId} for share`,
    );
    if (!stillClient) return "cliente saiu da agência";
    const [current] = await tx.select().from(clickupTaskPost).where(eq(clickupTaskPost.taskId, event.taskId)).limit(1);
    if (current?.state === "posted") return "já publicado";
    // Reaprovação de tarefa já agendada: substitui o agendamento ainda fora do alcance do cron.
    if (current?.scheduledPostId && current.state === "scheduled") {
      const [previous] = await tx
        .select({ deletedAt: scheduledPost.deletedAt })
        .from(scheduledPost)
        .where(eq(scheduledPost.id, current.scheduledPostId))
        .limit(1);
      if (previous && !previous.deletedAt) {
        const replaced = await tx.update(scheduledPost).set({ deletedAt: now, updatedAt: now }).where(editable(current.scheduledPostId)).returning({ id: scheduledPost.id });
        if (!replaced.length) return "tarde demais";
      }
    }
    const [created] = await tx.insert(scheduledPost).values({ ...values, createdAt: now }).returning({ id: scheduledPost.id });
    await tx
      .insert(clickupTaskPost)
      .values({ taskId: event.taskId, agencyId: event.agencyId, userId: decision.userId, scheduledPostId: created!.id, state: "scheduled", reportedState: "scheduled", approvedByClickupUserId: event.actorClickupUserId, updatedAt: now })
      .onConflictDoUpdate({
        target: clickupTaskPost.taskId,
        set: { userId: decision.userId, scheduledPostId: created!.id, state: "scheduled", reportedState: "scheduled", approvedByClickupUserId: event.actorClickupUserId, updatedAt: now },
      });
    return null;
  });
  if (outcome === "tarde demais") {
    await enqueue(event.agencyId, event.taskId, [{ kind: "comment", key: `change-late:${event.id}`, body: feedback.tooLateToChange(), mention: event.actorClickupUserId }]);
    return "já em publicação";
  }
  if (outcome === "cliente saiu da agência") {
    await refuse(event.agencyId, mapping, event.id, event.taskId, ["Este cliente não é mais da agência no Automatize."], event.actorClickupUserId);
    return `recusado: ${outcome}`;
  }
  if (outcome) return outcome;
  await enqueue(event.agencyId, event.taskId, [
    { kind: "status", key: `scheduled-status:${event.id}`, body: mapping.statuses.scheduled },
    { kind: "comment", key: `scheduled:${event.id}`, body: feedback.scheduled(decision.publishAt, username, decision.format) },
  ]);
  return `agendado para ${decision.publishAt.toISOString()}`;
}

/** Eventos sem processar (falha anterior, limite, função que morreu): 1 min depois de chegarem. */
export async function processPendingEvents(limit = 20) {
  const pending = await db
    .select({ id: clickupWebhookEvent.id })
    .from(clickupWebhookEvent)
    .where(
      and(
        isNull(clickupWebhookEvent.processedAt),
        lt(clickupWebhookEvent.attempts, MAX_EVENT_ATTEMPTS),
        lte(clickupWebhookEvent.receivedAt, new Date(Date.now() - 60_000)),
        or(isNull(clickupWebhookEvent.lockedUntil), lt(clickupWebhookEvent.lockedUntil, sql`now()`)),
      ),
    )
    .orderBy(asc(clickupWebhookEvent.receivedAt))
    .limit(limit);
  for (const { id } of pending) await processEvent(id);
  return pending.length;
}

// ---------------------------------------------------------------- feedback

function failureReason(raw: string | null): string {
  if (!raw) return "O Instagram recusou a publicação.";
  try {
    const parsed = JSON.parse(raw) as { error?: { error_user_msg?: string; message?: string }; message?: string };
    return parsed.error?.error_user_msg ?? parsed.error?.message ?? parsed.message ?? raw.slice(0, 300);
  } catch {
    return raw.slice(0, 300);
  }
}

/** Publicado ou falhou no cron do frontend: vira Retorno na Tarefa (uma vez por estado). */
export async function syncPublishResults(limit = 50) {
  const rows = await db
    .select({ link: clickupTaskPost, post: { status: scheduledPost.status, lastErrorMessage: scheduledPost.lastErrorMessage, deletedAt: scheduledPost.deletedAt } })
    .from(clickupTaskPost)
    .innerJoin(scheduledPost, eq(scheduledPost.id, clickupTaskPost.scheduledPostId))
    .where(and(eq(clickupTaskPost.state, "scheduled"), or(inArray(scheduledPost.status, ["posted", "failed"]), isNotNull(scheduledPost.deletedAt))))
    .limit(limit);
  const connections = new Map<string, ClickupMapping | null>();
  for (const { link, post } of rows) {
    if (!connections.has(link.agencyId)) {
      const connection = await getConnection(link.agencyId);
      connections.set(link.agencyId, connection ? mappingOf(connection) : null);
    }
    const mapping = connections.get(link.agencyId);
    const state = post.status === "posted" ? "posted" : post.deletedAt ? "cancelled" : "failed";
    await db.update(clickupTaskPost).set({ state, reportedState: state, updatedAt: new Date() }).where(and(eq(clickupTaskPost.taskId, link.taskId), eq(clickupTaskPost.state, "scheduled")));
    if (!mapping || state === "cancelled") continue;
    const key = `${state}:${link.taskId}:${link.scheduledPostId}`;
    if (state === "posted") {
      await enqueue(link.agencyId, link.taskId, [
        { kind: "status", key: `${key}:status`, body: mapping.statuses.published },
        { kind: "comment", key, body: feedback.published(null) },
      ]);
    } else {
      await enqueue(link.agencyId, link.taskId, [
        { kind: "comment", key, body: feedback.failed(failureReason(post.lastErrorMessage)), mention: link.approvedByClickupUserId },
        ...(mapping.statuses.error ? [{ kind: "status" as const, key: `${key}:status`, body: mapping.statuses.error }] : []),
      ]);
    }
  }
  return rows.length;
}

/**
 * Um status antigo pode terminar de enviar depois de um mais novo (execuções sobrepostas). Se o
 * mais novo da tarefa já foi enviado, manda de novo: o último status decidido é o que fica.
 */
async function reapplyNewestStatus(token: string, sentItem: typeof clickupOutbox.$inferSelect) {
  const [newest] = await db
    .select({ id: clickupOutbox.id, body: clickupOutbox.body, sentAt: clickupOutbox.sentAt })
    .from(clickupOutbox)
    // Compara com o created_at do banco (microssegundos), não com o Date do JS (milissegundos).
    .where(
      and(
        eq(clickupOutbox.taskId, sentItem.taskId),
        eq(clickupOutbox.kind, "status"),
        gt(clickupOutbox.createdAt, sql`(select ${clickupOutbox.createdAt} from ${clickupOutbox} where ${clickupOutbox.id} = ${sentItem.id})`),
      ),
    )
    .orderBy(desc(clickupOutbox.createdAt))
    .limit(1);
  if (newest?.sentAt) await setTaskStatus(token, sentItem.taskId, newest.body);
}

/** Manda o que está na fila. Falha do ClickUp só adia; nunca toca na publicação. */
export async function flushOutbox(limit = 40) {
  const due = await db
    .select()
    .from(clickupOutbox)
    .where(and(isNull(clickupOutbox.sentAt), lte(clickupOutbox.nextAttemptAt, sql`now()`), lt(clickupOutbox.attempts, MAX_OUTBOX_ATTEMPTS)))
    // Status antes do comentário da mesma tarefa: o comentário fala do estado novo.
    .orderBy(asc(clickupOutbox.createdAt), sql`case when ${clickupOutbox.kind} = 'status' then 0 else 1 end`)
    .limit(limit);
  // Comentário espera o status anterior da mesma tarefa: "publicado" não sai antes de mover a tarefa.
  const pendingStatus = await db
    .select({ id: clickupOutbox.id, taskId: clickupOutbox.taskId, createdAt: clickupOutbox.createdAt })
    .from(clickupOutbox)
    .where(and(isNull(clickupOutbox.sentAt), eq(clickupOutbox.kind, "status"), lt(clickupOutbox.attempts, MAX_OUTBOX_ATTEMPTS)));
  const tokens = new Map<string, string | null>();
  let sent = 0;
  for (const item of due) {
    if (item.kind === "comment" && pendingStatus.some((s) => s.taskId === item.taskId && s.createdAt <= item.createdAt)) continue;
    // Reivindica o item antes de chamar o ClickUp: duas execuções juntas não mandam duas vezes.
    const [claimed] = await db
      .update(clickupOutbox)
      .set({ nextAttemptAt: new Date(Date.now() + 5 * 60_000) })
      .where(and(eq(clickupOutbox.id, item.id), isNull(clickupOutbox.sentAt), lt(clickupOutbox.attempts, MAX_OUTBOX_ATTEMPTS), lte(clickupOutbox.nextAttemptAt, sql`now()`)))
      .returning({ id: clickupOutbox.id });
    if (!claimed) continue;
    if (!tokens.has(item.agencyId)) {
      const connection = await getConnection(item.agencyId);
      tokens.set(item.agencyId, connection?.status === "active" ? tokenOf(connection) : null);
    }
    const token = tokens.get(item.agencyId);
    if (!token) continue;
    try {
      if (item.kind === "status") await setTaskStatus(token, item.taskId, item.body);
      else await postComment(token, item.taskId, item.body, item.mentionClickupUserId);
      await db.update(clickupOutbox).set({ sentAt: new Date(), lastError: null }).where(eq(clickupOutbox.id, item.id));
      if (item.kind === "status") await reapplyNewestStatus(token, item);
      const index = pendingStatus.findIndex((s) => s.id === item.id);
      if (index >= 0) pendingStatus.splice(index, 1);
      sent++;
    } catch (error) {
      if (error instanceof ClickupAuthError) {
        await markNeedsReconnect(item.agencyId, error.message);
        tokens.set(item.agencyId, null);
      }
      const minutes = OUTBOX_BACKOFF_MIN[Math.min(item.attempts, OUTBOX_BACKOFF_MIN.length - 1)]!;
      // Recusa definitiva do ClickUp (status que não existe mais, tarefa apagada): não adianta
      // insistir, e um status preso seguraria o comentário de recusa por horas.
      const permanent = error instanceof ClickupApiError && error.status >= 400 && error.status < 500;
      const index = pendingStatus.findIndex((s) => s.id === item.id);
      if (permanent && index >= 0) pendingStatus.splice(index, 1);
      // Item superado enquanto estava em voo continua superado (não volta à fila).
      await db
        .update(clickupOutbox)
        .set({
          attempts: permanent ? MAX_OUTBOX_ATTEMPTS : sql`${clickupOutbox.attempts} + 1`,
          nextAttemptAt: new Date(Date.now() + minutes * 60_000),
          lastError: error instanceof Error ? error.message : String(error),
        })
        .where(and(eq(clickupOutbox.id, item.id), lt(clickupOutbox.attempts, MAX_OUTBOX_ATTEMPTS)));
      if (error instanceof ClickupRateLimitError) break;
    }
  }
  return sent;
}

/**
 * Webhook suspenso no ClickUp (falhas seguidas) volta a ativo no mesmo endereço; sem isso, nada mais
 * chega. Depois, reconcilia: tarefa parada no Status de Aprovação que nunca virou evento (perdida
 * enquanto o webhook estava suspenso ou a conexão caída) ganha um evento.
 */
export async function reviveWebhooks() {
  const connections = await db
    .select()
    .from(clickupConnection)
    .where(and(eq(clickupConnection.status, "active"), isNotNull(clickupConnection.mapping), isNotNull(clickupConnection.teamId)));
  for (const connection of connections) {
    try {
      const token = tokenOf(connection);
      const hooks = connection.webhookId ? await getWebhooks(token, connection.teamId!) : [];
      const hook = hooks.find((h) => h.id === connection.webhookId);
      if (!connection.webhookId) {
        // Sem webhook (criação falhou ou sumiu): só a reconciliação abaixo traz as aprovações.
      } else if (hook && hook.health?.status && hook.health.status !== "active") {
        await reactivateWebhook(token, hook.id, hook.endpoint);
      } else if (!hook) {
        // Apagado no ClickUp: a tela volta a pedir o mapeamento (salvar recria o webhook).
        await db
          .update(clickupConnection)
          .set({ webhookId: null, webhookSecretEncrypted: null, statusDetail: "O webhook sumiu do ClickUp. Salve o mapeamento de novo.", updatedAt: new Date() })
          .where(eq(clickupConnection.agencyId, connection.agencyId));
      }
      await reconcileApprovals(connection, token);
    } catch (error) {
      if (error instanceof ClickupAuthError) await markNeedsReconnect(connection.agencyId, error.message);
      else console.error("[clickup] saúde do webhook", connection.agencyId, error);
    }
  }
}

/** Tarefas no Status de Aprovação sem evento tratado nem agendamento viram evento sintético. */
async function reconcileApprovals(connection: Connection, token: string) {
  const mapping = mappingOf(connection);
  if (!mapping) return 0;
  const taskIds = await getListTaskIdsInStatus(token, mapping.listId, mapping.statuses.approval);
  if (!taskIds.length) return 0;
  const idList = sql.join(taskIds.map((id) => sql`${id}`), sql`, `);
  // Conhecida = evento ainda pendente, agendamento vivo/publicado, ou evento tratado depois da última
  // mudança do vínculo (uma reaprovação depois de falha ou cancelamento volta a ser candidata).
  const known = await db.execute<{ task_id: string }>(sql`
    select e.task_id from ${clickupWebhookEvent} e
    left join ${clickupTaskPost} t on t.task_id = e.task_id
    where e.agency_id = ${connection.agencyId} and e.task_id in (${idList})
      and (e.processed_at is null or t.task_id is null or e.processed_at > t.updated_at)
    union
    select t.task_id from ${clickupTaskPost} t
    where t.task_id in (${idList}) and t.state in ('scheduled', 'posted')
  `).then((rows) => new Set(Array.from(rows as unknown as Array<{ task_id: string }>).map((r) => r.task_id)));
  const missing = taskIds.filter((id) => !known.has(id));
  if (!missing.length) return 0;
  await db
    .insert(clickupWebhookEvent)
    .values(missing.map((taskId) => ({ id: `reconcile:${taskId}:${Date.now()}`, agencyId: connection.agencyId, taskId, intent: "schedule", actorClickupUserId: null })))
    .onConflictDoNothing();
  return missing.length;
}

/** Reconectar o ClickUp reabre os eventos que ficaram esperando (token revogado ou limite). */
export async function reopenPendingEvents(agencyId: string) {
  await db
    .update(clickupWebhookEvent)
    .set({ attempts: 0, lockedUntil: null })
    .where(and(eq(clickupWebhookEvent.agencyId, agencyId), isNull(clickupWebhookEvent.processedAt)));
}
