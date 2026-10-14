/**
 * Postagem pelo ClickUp contra um Postgres de verdade, com ClickUp e storage simulados. Sozinho:
 *
 *   CLICKUP_TEST_URL=postgres://postgres@localhost:55433/postgres bun test lib/clickup/service.integration.test.ts
 *
 * Cria o banco `clickup_it`, as tabelas mínimas e aplica as migrations 0136 a 0138 de verdade.
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
// @ts-expect-error Bun's runtime mock API is absent from this repository's test declarations.
import { mock } from "bun:test";
import postgres from "postgres";
import type { ClickupMapping, ClickupTask } from "./core";

const BASE_URL = process.env.CLICKUP_TEST_URL;
const DB_NAME = "clickup_it";

process.env.META_TOKEN_ENCRYPTION_KEYS = `v1:${randomBytes(32).toString("base64")}`;

// ---- ClickUp simulado: tarefas em memória, escritas registradas, falhas sob demanda.
const tasks = new Map<string, ClickupTask>();
const writes: Array<{ kind: string; taskId: string; body: string; mention?: string | null }> = [];
let failWrites = 0;
/** Status que o ClickUp recusa de vez (400), como um status renomeado. */
let rejectStatus: string | null = null;
/** Roda no meio do envio de um status (simula outra execução da fila em paralelo). */
let duringStatus: ((status: string) => Promise<void>) | null = null;
let failAfterHook = false;
let authDown = false;
class ClickupAuthError extends Error {}
class ClickupRateLimitError extends Error {}
class ClickupApiError extends Error {
  constructor(message: string, readonly status = 404) {
    super(message);
  }
}
mock.module("server-only", () => ({}));
mock.module("@/lib/clickup/api", () => ({
  ClickupAuthError,
  ClickupRateLimitError,
  ClickupApiError,
  getTask: async (_token: string, id: string) => {
    if (authDown) throw new ClickupAuthError("Token not found");
    const task = tasks.get(id);
    if (!task) throw new ClickupApiError("not found");
    return structuredClone(task);
  },
  setTaskStatus: async (_token: string, taskId: string, status: string) => {
    if (rejectStatus === status) throw new ClickupApiError("Status does not exist", 400);
    if (duringStatus) {
      const hook = duringStatus;
      duringStatus = null;
      await hook(status);
      if (failAfterHook) {
        failAfterHook = false;
        throw new Error("timeout");
      }
    }
    if (failWrites > 0) {
      failWrites--;
      throw new Error("ClickUp fora do ar");
    }
    writes.push({ kind: "status", taskId, body: status });
    tasks.get(taskId)!.status.status = status;
  },
  postComment: async (_token: string, taskId: string, text: string, mention?: string | null) => {
    if (failWrites > 0) {
      failWrites--;
      throw new Error("ClickUp fora do ar");
    }
    writes.push({ kind: "comment", taskId, body: text, mention });
  },
  getWebhooks: async () => [],
  getListTaskIdsInStatus: async (_token: string, _listId: string, status: string) =>
    [...tasks.values()].filter((t) => t.status.status === status).map((t) => t.id),
  reactivateWebhook: async () => ({}),
}));
let mediaCopies = 0;
/** Roda no meio da cópia da mídia (para simular mudanças enquanto o download acontece). */
let onCopy: (() => Promise<void>) | null = null;
class MediaError extends Error {}
mock.module("@/lib/clickup/media", () => ({
  MediaError,
  copyTaskMedia: async (input: { media: Array<{ kind: string }>; taskId: string }) => {
    mediaCopies++;
    await new Promise((r) => setTimeout(r, 30));
    if (onCopy) await onCopy();
    return input.media.map((m, i) => ({ url: `https://media.test/${input.taskId}/${mediaCopies}-${i}`, kind: m.kind }));
  },
  sniffPostMedia: () => null,
}));

type Service = typeof import("./service");

describe("ClickUp → agendamento: fluxo no banco", { skip: !BASE_URL }, () => {
  let sql: ReturnType<typeof postgres>;
  let service: Service;
  const AGENCY = "a0000000-0000-4000-8000-00000000000a";
  const CLIENT = "d0000000-0000-4000-8000-000000000001";
  const SECRET = "segredo-do-webhook";
  const HOOK = "wh-1";
  const LATER = Date.now() + 3 * 3600_000;
  const mapping: ClickupMapping = {
    listId: "list-1",
    listName: "Publicação",
    clientFieldId: "f-client",
    mediaFieldId: "f-media",
    captionFieldId: "f-caption",
    publishAtFieldId: "f-when",
    formats: { "0": "post" },
    statuses: { approval: "para agendar", scheduled: "agendado", published: "publicado", error: null },
    clientOptions: { "opt-1": CLIENT },
  };

  const taskWith = (id: string, overrides: Partial<{ client: unknown; when: number; status: string }> = {}): ClickupTask => ({
    id,
    name: `Post ${id}`,
    status: { status: overrides.status ?? "para agendar" },
    custom_item_id: null,
    list: { id: "list-1" },
    custom_fields: [
      { id: "f-client", type: "drop_down", value: "client" in overrides ? overrides.client : 0, type_config: { options: [{ id: "opt-1", name: "Alquimia", orderindex: 0 }] } },
      { id: "f-media", type: "attachment", value: [{ url: "https://t.clickup-attachments.com/arte.png", mimetype: "image/png" }] },
      { id: "f-caption", type: "text", value: "Legenda" },
      { id: "f-when", type: "date", value: String(overrides.when ?? LATER) },
    ],
  });

  const body = (taskId: string, historyId: string, from: string, to: string, webhookId = HOOK) =>
    JSON.stringify({
      event: "taskStatusUpdated",
      webhook_id: webhookId,
      task_id: taskId,
      history_items: [{ id: historyId, field: "status", date: String(Date.now()), user: { id: 42 }, before: { status: from }, after: { status: to } }],
    });
  const sign = (raw: string, secret = SECRET) => createHmac("sha256", secret).update(raw).digest("hex");

  before(async () => {
    const admin = postgres(BASE_URL!, { max: 1 });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    await admin.end();
    const url = new URL(BASE_URL!);
    url.pathname = `/${DB_NAME}`;
    process.env.POSTGRES_URL = url.toString();
    sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
    await sql.unsafe(`
      CREATE TABLE users (id uuid PRIMARY KEY, email varchar(64) NOT NULL UNIQUE, name text);
      CREATE TABLE backoffice_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(100) NOT NULL UNIQUE, role varchar NOT NULL);
      CREATE TABLE instagram_accounts (id text PRIMARY KEY, user_id uuid NOT NULL, account_id text NOT NULL, username text,
        needs_reconnect_at timestamp, created_at timestamp NOT NULL DEFAULT now(), deleted_at timestamp);
      CREATE TABLE scheduled_posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
        ai_generated_image_id uuid, media_url text, carousel_items jsonb, media_type varchar(32), caption text, location_id text,
        user_tags_json text, scheduled_at timestamp NOT NULL, status varchar(32) NOT NULL DEFAULT 'pending',
        retry_attempts integer NOT NULL DEFAULT 0, last_attempt_at timestamp, last_error_message text, media_container_id text UNIQUE,
        media_container_status varchar(32), published_at timestamp, created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(), deleted_at timestamp);
    `);
    // Abre a janela da corrida: cada agendamento novo leva 150 ms dentro da transação.
    await sql.unsafe(`
      CREATE FUNCTION slow_insert() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER slow_insert BEFORE INSERT ON scheduled_posts FOR EACH ROW EXECUTE FUNCTION slow_insert();
    `);
    for (const file of ["0136_agencies.sql", "0137_clickup_publishing.sql", "0138_agency_plan.sql"]) {
      const migration = readFileSync(join(process.cwd(), "lib/db/migrations", file), "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) await sql.unsafe(statement);
    }
    service = await import("./service");
  });

  after(async () => {
    const { postgresClient } = await import("@/lib/db");
    await postgresClient.end();
    await sql?.end();
  });

  beforeEach(async () => {
    await sql.unsafe(`TRUNCATE clickup_outbox, clickup_task_posts, clickup_webhook_events, clickup_connections, scheduled_posts, instagram_accounts, agency_clients, agencies, users CASCADE`);
    const { encryptAccessToken } = await import("@/lib/meta-business/token-vault");
    // Plano pago (ADR 0046): sem ele, nenhuma tarefa vira agendamento.
    await sql`INSERT INTO agencies (id, name, plan_client_limit, plan_status, plan_paid_until) VALUES (${AGENCY}, 'Infinite', 4, 'active', now() + interval '20 days')`;
    await sql`INSERT INTO users (id, email) VALUES (${CLIENT}, 'alquimia@x.com')`;
    await sql`INSERT INTO agency_clients (user_id, agency_id, added_by_email) VALUES (${CLIENT}, ${AGENCY}, 't')`;
    await sql`INSERT INTO instagram_accounts (id, user_id, account_id, username) VALUES ('ig-1', ${CLIENT}, '1789', 'alquimiarj')`;
    await sql`INSERT INTO clickup_connections (agency_id, access_token_encrypted, clickup_user_id, team_id, mapping, webhook_id, webhook_secret_encrypted, connected_by_email)
      VALUES (${AGENCY}, ${encryptAccessToken("tok")}, '7', 'team-1', ${sql.json(mapping as never)}, ${HOOK}, ${encryptAccessToken(SECRET)}, 'dono@x.com')`;
    tasks.clear();
    writes.length = 0;
    failWrites = 0;
    onCopy = null;
    rejectStatus = null;
    authDown = false;
    duringStatus = null;
    failAfterHook = false;
  });

  async function approve(taskId: string, historyId = `h-${taskId}`) {
    const raw = body(taskId, historyId, "em produção", "para agendar");
    const outcome = await service.recordWebhook(AGENCY, raw, sign(raw));
    assert.equal(outcome.status, 200);
    return outcome.newEventIds;
  }

  const livePosts = (taskId?: string) =>
    sql`SELECT sp.* FROM scheduled_posts sp ${taskId ? sql`JOIN clickup_task_posts t ON t.scheduled_post_id = sp.id AND t.task_id = ${taskId}` : sql``} WHERE sp.deleted_at IS NULL`;

  it("assinatura errada é 400 e não grava; evento repetido não duplica; webhook de outro id é ignorado", async () => {
    tasks.set("t1", taskWith("t1"));
    const raw = body("t1", "h1", "em produção", "para agendar");
    assert.equal((await service.recordWebhook(AGENCY, raw, sign(raw, "outro"))).status, 400);
    assert.equal((await service.recordWebhook(AGENCY, raw, sign(raw))).newEventIds.length, 1);
    assert.equal((await service.recordWebhook(AGENCY, raw, sign(raw))).newEventIds.length, 0);
    const foreign = body("t1", "h9", "em produção", "para agendar", "wh-velho");
    assert.equal((await service.recordWebhook(AGENCY, foreign, sign(foreign))).newEventIds.length, 0);
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM clickup_webhook_events`;
    assert.equal(count, 1);
  });

  it("tarefa aprovada vira agendamento na conta do cliente e o retorno vai para a fila", async () => {
    tasks.set("t1", taskWith("t1"));
    const [eventId] = await approve("t1");
    assert.match(String(await service.processEvent(eventId!)), /^agendado/);
    const posts = await livePosts("t1");
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.user_id, CLIENT);
    assert.equal(posts[0]!.media_type, "IMAGE");
    assert.equal(posts[0]!.status, "pending");
    assert.equal(await service.flushOutbox(), 2);
    assert.deepEqual(writes.map((w) => w.kind), ["status", "comment"]);
    assert.equal(writes[0]!.body, "agendado");
    assert.match(writes[1]!.body, /post agendado para .* no @alquimiarj/);
    // O eco da nossa mudança para "agendado" não vira evento.
    const echo = body("t1", "h-echo", "para agendar", "agendado");
    assert.equal((await service.recordWebhook(AGENCY, echo, sign(echo))).newEventIds.length, 0);
  });

  it("o mesmo evento processado em paralelo agenda uma vez só", async () => {
    tasks.set("t1", taskWith("t1"));
    const [eventId] = await approve("t1");
    const results = await Promise.all([service.processEvent(eventId!), service.processEvent(eventId!)]);
    assert.equal(results.filter((r) => r !== null).length, 1);
    assert.equal((await livePosts()).length, 1);
  });

  it("duas aprovações da mesma tarefa ao mesmo tempo deixam um agendamento vivo", async () => {
    tasks.set("t1", taskWith("t1"));
    const [a] = await approve("t1", "h-a");
    const [b] = await approve("t1", "h-b");
    await Promise.all([service.processEvent(a!), service.processEvent(b!)]);
    assert.equal((await livePosts()).length, 1);
  });

  it("recusa diz o que falta, menciona quem aprovou e não cria agendamento", async () => {
    tasks.set("t1", taskWith("t1", { client: null, when: Date.now() + 60_000 }));
    const [eventId] = await approve("t1");
    assert.match(String(await service.processEvent(eventId!)), /^recusado/);
    assert.equal((await livePosts()).length, 0);
    await service.flushOutbox();
    assert.equal(writes.length, 1);
    assert.equal(writes[0]!.mention, "42");
    assert.match(writes[0]!.body, /campo Cliente[\s\S]*5 minutos/);
  });

  it("agência com o plano vencido (além da carência) tem a tarefa recusada", async () => {
    await sql`UPDATE agencies SET plan_paid_until = now() - interval '4 days', plan_status = 'past_due'`;
    tasks.set("t1", taskWith("t1"));
    const [eventId] = await approve("t1");
    assert.match(String(await service.processEvent(eventId!)), /plano da agência/);
    assert.equal((await livePosts()).length, 0);
    // Dentro da carência ainda agenda.
    await sql`UPDATE agencies SET plan_paid_until = now() - interval '2 days'`;
    const [again] = await approve("t1", "h-2");
    assert.match(String(await service.processEvent(again!)), /^agendado/);
  });

  it("cliente sem Instagram ou fora da agência é recusado", async () => {
    await sql`UPDATE instagram_accounts SET needs_reconnect_at = now()`;
    tasks.set("t1", taskWith("t1"));
    const [eventId] = await approve("t1");
    assert.match(String(await service.processEvent(eventId!)), /reconectado/);
    await sql`DELETE FROM agency_clients`;
    const [again] = await approve("t1", "h-2");
    assert.match(String(await service.processEvent(again!)), /não é mais da agência/);
  });

  it("reaprovar troca o agendamento pendente; tirar do Agendado cancela", async () => {
    tasks.set("t1", taskWith("t1"));
    await service.processEvent((await approve("t1", "h-1"))[0]!);
    await service.processEvent((await approve("t1", "h-2"))[0]!);
    assert.equal((await livePosts()).length, 1);
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM scheduled_posts WHERE deleted_at IS NOT NULL`;
    assert.equal(count, 1);

    tasks.get("t1")!.status.status = "em produção";
    const raw = body("t1", "h-3", "agendado", "em produção");
    const [cancelId] = (await service.recordWebhook(AGENCY, raw, sign(raw))).newEventIds;
    assert.equal(await service.processEvent(cancelId!), "cancelado");
    assert.equal((await livePosts()).length, 0);
  });

  it("perto do horário (cron pode estar publicando) não cancela nem troca, e avisa na tarefa", async () => {
    tasks.set("t1", taskWith("t1"));
    await service.processEvent((await approve("t1", "h-1"))[0]!);
    await service.flushOutbox();
    writes.length = 0;
    // O cron mantém "pending" enquanto chama a Meta; o que protege é o horário já na janela.
    await sql`UPDATE scheduled_posts SET scheduled_at = now() AT TIME ZONE 'UTC' + interval '30 seconds'`;
    tasks.get("t1")!.status.status = "em produção";
    const raw = body("t1", "h-3", "agendado", "em produção");
    assert.equal(await service.processEvent((await service.recordWebhook(AGENCY, raw, sign(raw))).newEventIds[0]!), "já estava em publicação");
    assert.equal((await livePosts()).length, 1);
    tasks.get("t1")!.status.status = "para agendar";
    assert.equal(await service.processEvent((await approve("t1", "h-4"))[0]!), "já em publicação");
    assert.equal((await livePosts()).length, 1);
    await service.flushOutbox();
    assert.ok(writes.some((w) => /não deu para cancelar/.test(w.body)));
    assert.ok(writes.some((w) => /as mudanças não entram/.test(w.body)));
  });

  it("cliente removido da agência durante a cópia da mídia não ganha agendamento", async () => {
    tasks.set("t1", taskWith("t1"));
    onCopy = async () => {
      await sql`DELETE FROM agency_clients WHERE user_id = ${CLIENT}`;
    };
    assert.match(String(await service.processEvent((await approve("t1"))[0]!)), /cliente saiu da agência/);
    assert.equal((await livePosts()).length, 0);
  });

  it("aprovação retirada durante a cópia não agenda; a retirada vira cancelamento", async () => {
    tasks.set("t1", taskWith("t1"));
    onCopy = async () => {
      tasks.get("t1")!.status.status = "em produção";
    };
    assert.equal(await service.processEvent((await approve("t1"))[0]!), "aprovação retirada durante o processamento");
    assert.equal((await livePosts()).length, 0);
    const raw = body("t1", "h-w", "para agendar", "em produção");
    assert.equal((await service.recordWebhook(AGENCY, raw, sign(raw))).newEventIds.length, 1);
  });

  it("cliente que sai da agência tem os agendamentos do ClickUp cancelados", async () => {
    tasks.set("t1", taskWith("t1"));
    await service.processEvent((await approve("t1"))[0]!);
    await sql`DELETE FROM agency_clients WHERE user_id = ${CLIENT}`;
    await service.cancelClickupPostsOfClient(AGENCY, CLIENT);
    assert.equal((await livePosts()).length, 0);
    const [{ state }] = await sql`SELECT state FROM clickup_task_posts WHERE task_id = 't1'`;
    assert.equal(state, "cancelled");
  });

  it("status antigo que falhou não volta a tarefa de publicado para agendado", async () => {
    tasks.set("t1", taskWith("t1"));
    await service.processEvent((await approve("t1"))[0]!);
    failWrites = 1; // "agendado" falha
    await service.flushOutbox();
    await sql`UPDATE scheduled_posts SET status = 'posted'`;
    await service.syncPublishResults();
    await sql`UPDATE clickup_outbox SET next_attempt_at = now() - interval '1 second' WHERE sent_at IS NULL`;
    await service.flushOutbox();
    await sql`UPDATE clickup_outbox SET next_attempt_at = now() - interval '1 second' WHERE sent_at IS NULL`;
    await service.flushOutbox();
    const statuses = writes.filter((w) => w.kind === "status").map((w) => w.body);
    assert.deepEqual(statuses, ["publicado"]);
    assert.equal(tasks.get("t1")!.status.status, "publicado");
  });

  it("duas execuções da fila ao mesmo tempo não duplicam comentário", async () => {
    tasks.set("t1", taskWith("t1"));
    await service.processEvent((await approve("t1"))[0]!);
    await Promise.all([service.flushOutbox(), service.flushOutbox()]);
    assert.equal(writes.filter((w) => w.kind === "comment").length, 1);
    assert.equal(writes.filter((w) => w.kind === "status").length, 1);
  });

  it("token revogado não gasta as tentativas; reconectar reabre e o evento agenda", async () => {
    tasks.set("t1", taskWith("t1"));
    const [eventId] = await approve("t1");
    authDown = true;
    for (let i = 0; i < 7; i++) {
      assert.equal(await service.processEvent(eventId!), "reconectar ClickUp");
      await sql`UPDATE clickup_webhook_events SET locked_until = NULL`;
      await sql`UPDATE clickup_connections SET status = 'active'`;
    }
    const [{ status }] = await sql`SELECT status FROM clickup_connections`;
    assert.equal(status, "active");
    authDown = false;
    await service.reopenPendingEvents(AGENCY);
    assert.match(String(await service.processEvent(eventId!)), /^agendado/);
  });

  it("tarefa aprovada que nunca virou evento (webhook suspenso) é achada pela reconciliação", async () => {
    tasks.set("t9", taskWith("t9"));
    tasks.set("t8", taskWith("t8", { status: "em produção" }));
    await service.reviveWebhooks();
    const events = await sql`SELECT id, task_id FROM clickup_webhook_events`;
    assert.deepEqual(events.map((e) => e.task_id), ["t9"]);
    assert.match(String(await service.processEvent(events[0]!.id)), /^agendado/);
    // Tarefa já tratada (recusada ou agendada) não ganha evento de novo.
    await service.reviveWebhooks();
    assert.equal((await sql`SELECT count(*)::int AS n FROM clickup_webhook_events`)[0]!.n, 1);
  });

  it("reconciliação não duplica evento pendente e pega reaprovação depois de falha", async () => {
    tasks.set("t1", taskWith("t1"));
    await approve("t1"); // evento ainda pendente
    await service.reviveWebhooks();
    assert.equal((await sql`SELECT count(*)::int AS n FROM clickup_webhook_events`)[0]!.n, 1);
    // Processa, publica e falha; a agência corrige e reaprova com o webhook fora do ar.
    const [{ id }] = await sql`SELECT id FROM clickup_webhook_events`;
    await service.processEvent(id);
    await sql`UPDATE scheduled_posts SET status = 'failed'`;
    await service.syncPublishResults();
    await service.reviveWebhooks();
    const events = await sql`SELECT id FROM clickup_webhook_events WHERE id LIKE 'reconcile:%'`;
    assert.equal(events.length, 1);
    assert.match(String(await service.processEvent(events[0]!.id)), /^agendado/);
    // Webhook sumido do ClickUp: a conexão para de dizer que recebe, e a reconciliação continua.
    const [{ webhook_id }] = await sql`SELECT webhook_id FROM clickup_connections`;
    assert.equal(webhook_id, null);
    tasks.set("t2", taskWith("t2"));
    await service.reviveWebhooks();
    assert.equal((await sql`SELECT count(*)::int AS n FROM clickup_webhook_events WHERE task_id = 't2'`)[0]!.n, 1);
  });

  it("status que o ClickUp recusa de vez não segura o comentário", async () => {
    await sql`UPDATE clickup_connections SET mapping = jsonb_set(mapping, '{statuses,error}', '"erro"')`;
    tasks.set("t1", taskWith("t1", { client: null }));
    rejectStatus = "erro";
    await service.processEvent((await approve("t1"))[0]!);
    await service.flushOutbox();
    await service.flushOutbox();
    assert.equal(writes.filter((w) => w.kind === "comment").length, 1);
    const [{ attempts }] = await sql`SELECT attempts FROM clickup_outbox WHERE kind = 'status'`;
    assert.equal(attempts, 8);
  });

  it("retirar a aprovação com o 'Agendado' ainda na fila: a escrita é descartada e o post cancelado", async () => {
    tasks.set("t1", taskWith("t1"));
    await service.processEvent((await approve("t1"))[0]!);
    tasks.get("t1")!.status.status = "em produção";
    const raw = body("t1", "h-w", "para agendar", "em produção");
    const [cancelId] = (await service.recordWebhook(AGENCY, raw, sign(raw))).newEventIds;
    await service.flushOutbox();
    assert.ok(!writes.some((w) => w.kind === "status"));
    assert.equal(await service.processEvent(cancelId!), "cancelado");
    assert.equal((await livePosts()).length, 0);
    assert.equal(tasks.get("t1")!.status.status, "em produção");
  });

  it("'Agendado' nosso enviado depois da retirada não desfaz o cancelamento; a tarefa volta ao status da pessoa", async () => {
    tasks.set("t1", taskWith("t1"));
    await service.processEvent((await approve("t1"))[0]!);
    // A fila já estava mandando "Agendado" quando a pessoa tirou a tarefa da aprovação.
    await sql`UPDATE clickup_outbox SET next_attempt_at = now() + interval '1 hour'`;
    tasks.get("t1")!.status.status = "em produção";
    const raw = body("t1", "h-w", "para agendar", "em produção");
    const [cancelId] = (await service.recordWebhook(AGENCY, raw, sign(raw))).newEventIds;
    await sql`UPDATE clickup_outbox SET sent_at = now() + interval '1 second' WHERE kind = 'status'`;
    tasks.get("t1")!.status.status = "agendado";
    assert.equal(await service.processEvent(cancelId!), "cancelado");
    assert.equal((await livePosts()).length, 0);
    await service.flushOutbox();
    assert.equal(tasks.get("t1")!.status.status, "em produção");
    // Já a pessoa voltando para "Agendado" por conta própria não cancela.
    tasks.set("t2", taskWith("t2"));
    await service.processEvent((await approve("t2"))[0]!);
    await service.flushOutbox();
    const raw2 = body("t2", "h-x", "agendado", "em produção");
    const [cancel2] = (await service.recordWebhook(AGENCY, raw2, sign(raw2))).newEventIds;
    tasks.get("t2")!.status.status = "agendado";
    assert.equal(await service.processEvent(cancel2!), "voltou para agendado");
    assert.equal((await livePosts("t2")).length, 1);
  });

  it("status antigo em voo que termina depois do novo não fica por cima; se falhar, não volta à fila", async () => {
    tasks.set("t1", taskWith("t1"));
    await service.processEvent((await approve("t1"))[0]!);
    // Enquanto "agendado" está em voo, o post publica e outra execução manda "publicado".
    duringStatus = async () => {
      await sql`UPDATE scheduled_posts SET status = 'posted'`;
      await service.syncPublishResults();
      await service.flushOutbox();
    };
    await service.flushOutbox();
    assert.equal(tasks.get("t1")!.status.status, "publicado");

    tasks.set("t2", taskWith("t2"));
    await service.processEvent((await approve("t2"))[0]!);
    duringStatus = async () => {
      await sql`UPDATE scheduled_posts sp SET status = 'posted' FROM clickup_task_posts t WHERE t.scheduled_post_id = sp.id AND t.task_id = 't2'`;
      await service.syncPublishResults();
      await service.flushOutbox();
    };
    failAfterHook = true;
    await service.flushOutbox();
    const [{ attempts }] = await sql`SELECT attempts FROM clickup_outbox WHERE task_id = 't2' AND kind = 'status' AND body = 'agendado'`;
    assert.equal(attempts, 8);
    assert.equal(tasks.get("t2")!.status.status, "publicado");
  });

  it("post já em publicação não é cancelado nem trocado", async () => {
    tasks.set("t1", taskWith("t1"));
    await service.processEvent((await approve("t1", "h-1"))[0]!);
    await sql`UPDATE scheduled_posts SET status = 'processing'`;
    tasks.get("t1")!.status.status = "em produção";
    const raw = body("t1", "h-3", "agendado", "em produção");
    assert.equal(await service.processEvent((await service.recordWebhook(AGENCY, raw, sign(raw))).newEventIds[0]!), "já estava em publicação");
    tasks.get("t1")!.status.status = "para agendar";
    assert.equal(await service.processEvent((await approve("t1", "h-4"))[0]!), "já em publicação");
    assert.equal((await livePosts()).length, 1);
  });

  it("publicado e falhou viram retorno na tarefa uma vez; falha do ClickUp só adia", async () => {
    tasks.set("t1", taskWith("t1"));
    tasks.set("t2", taskWith("t2"));
    await service.processEvent((await approve("t1"))[0]!);
    await service.processEvent((await approve("t2"))[0]!);
    await service.flushOutbox();
    writes.length = 0;
    await sql`UPDATE scheduled_posts sp SET status = 'posted' FROM clickup_task_posts t WHERE t.scheduled_post_id = sp.id AND t.task_id = 't1'`;
    await sql`UPDATE scheduled_posts sp SET status = 'failed', last_error_message = ${JSON.stringify({ error: { error_user_msg: "Imagem com proporção inválida." } })} FROM clickup_task_posts t WHERE t.scheduled_post_id = sp.id AND t.task_id = 't2'`;
    assert.equal(await service.syncPublishResults(), 2);
    assert.equal(await service.syncPublishResults(), 0);

    failWrites = 1;
    await service.flushOutbox();
    const [{ pending }] = await sql`SELECT count(*)::int AS pending FROM clickup_outbox WHERE sent_at IS NULL`;
    assert.ok(pending >= 1);
    await sql`UPDATE clickup_outbox SET next_attempt_at = now() - interval '1 second' WHERE sent_at IS NULL`;
    await service.flushOutbox();
    const t1 = writes.filter((w) => w.taskId === "t1").map((w) => w.body);
    const t2 = writes.filter((w) => w.taskId === "t2").map((w) => w.body);
    assert.deepEqual(t1, ["publicado", "Automatize: publicado."]);
    assert.equal(t2.length, 1);
    assert.match(t2[0]!, /falhou\. Imagem com proporção inválida\./);
  });
});
