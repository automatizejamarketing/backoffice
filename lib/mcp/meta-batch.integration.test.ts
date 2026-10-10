import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error Bun's runtime test API is absent from this repository's test declarations.
import { afterAll, beforeAll, describe, it, mock } from "bun:test";
import postgres from "postgres";
import { ensureMetaTestEnv, graphErrorBody, installMetaFetchStub, type MetaFetchStub } from "../../tests/helpers/meta-fetch-stub";

// Explicit local-only integration check against a throwaway database; never connects to staging
// or production. Run it alone (it replaces modules with mock.module). Example:
//   META_BATCH_TEST_URL=postgres://postgres@localhost:55432/postgres bun test lib/mcp/meta-batch.integration.test.ts
const adminUrl = process.env.META_BATCH_TEST_URL;
const isLocal = adminUrl ? /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(adminUrl) : false;
const DATABASE = "meta_batch_it";

const CLIENT_A = "00000000-0000-4000-8000-00000000000a";
const CLIENT_B = "00000000-0000-4000-8000-00000000000b";
const OUTSIDE = "00000000-0000-4000-8000-00000000000c";
const ORIGIN = "https://backoffice.test";

type Kind = "campaign" | "adset" | "ad";
type Obj = { id: string; kind: Kind; status: string; effective_status: string; account_id: string; daily_budget?: string; name: string };

// bun-test.d.ts only declares what the unit suites use; skipIf is Bun's runtime API.
const describeWithDatabase = (describe as unknown as { skipIf(skip: boolean): typeof describe }).skipIf(!adminUrl);

describeWithDatabase("Meta Ads batch (Postgres + Graph stub)", () => {
  let client: ReturnType<typeof postgres>;
  let batch: typeof import("./meta-batch");
  let stub: MetaFetchStub;
  const audits: { kind: string; id: string; applied: boolean }[] = [];
  const meta = new Map<string, Obj>();
  let writeFailures = new Map<string, number>();
  /** Escritas que a Meta aplica, mas cuja resposta se perde (conexão caída). */
  let lostResponses = new Set<string>();
  let streamDown = false;
  /** Chamado quando um POST chega, antes de aplicar: simula outra pessoa mexendo durante a execução. */
  let onWrite: (id: string) => Promise<void> | void = () => {};
  let actor: { id: string; email: string; role: "marketing_consultant"; source: "database"; assignedUserIds: string[] };

  const ONLY_FIELD: Record<Kind, string> = { campaign: "objective", adset: "optimization_goal", ad: "creative" };

  function resetMeta() {
    meta.clear();
    writeFailures = new Map();
    lostResponses = new Set();
    streamDown = false;
    onWrite = () => {};
    audits.length = 0;
    meta.set("101", { id: "101", kind: "campaign", name: "Vendas A", status: "ACTIVE", effective_status: "ACTIVE", account_id: "111", daily_budget: "5000" });
    meta.set("102", { id: "102", kind: "campaign", name: "Leads A", status: "ACTIVE", effective_status: "ACTIVE", account_id: "111", daily_budget: "3000" });
    meta.set("201", { id: "201", kind: "campaign", name: "Vendas B", status: "PAUSED", effective_status: "PAUSED", account_id: "222", daily_budget: "8000" });
    meta.set("301", { id: "301", kind: "ad", name: "Anúncio A", status: "ACTIVE", effective_status: "ACTIVE", account_id: "111" });
    meta.set("999", { id: "999", kind: "campaign", name: "Outro negócio", status: "ACTIVE", effective_status: "ACTIVE", account_id: "999", daily_budget: "1000" });
  }

  /** Graph recusa um campo que não existe no tipo do objeto, como a real. */
  function fits(object: Obj, fields: string) {
    return !Object.entries(ONLY_FIELD).some(([kind, field]) => kind !== object.kind && fields.includes(field));
  }

  beforeAll(async () => {
    assert.ok(isLocal, "META_BATCH_TEST_URL must point to localhost");
    const admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DATABASE}`);
    await admin.unsafe(`CREATE DATABASE ${DATABASE}`);
    await admin.end();
    const url = adminUrl!.replace(/\/[^/]*$/, `/${DATABASE}`);
    process.env.POSTGRES_URL = url;
    client = postgres(url, { max: 2, onnotice: () => {} });
    await client.unsafe(`
      CREATE TABLE backoffice_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(100) NOT NULL);
      CREATE TABLE meta_tracking_account_coverage (user_id uuid NOT NULL, account_id text NOT NULL, business_date date NOT NULL);
      CREATE TABLE meta_tracking_change_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_id text NOT NULL, note text);
    `);
    const migration = readFileSync(new URL("../db/migrations/0132_meta_ads_batches.sql", import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) await client.unsafe(statement);
    const [row] = await client`INSERT INTO backoffice_users (email) VALUES ('consultor@automatize.com') RETURNING id`;
    actor = { id: row.id as string, email: "consultor@automatize.com", role: "marketing_consultant", source: "database", assignedUserIds: [CLIENT_A, CLIENT_B] };

    ensureMetaTestEnv();
    mock.module("server-only", () => ({}));
    mock.module("@/lib/meta-business/get-user-access-token", () => ({
      getUserAccessTokenByUserId: async (userId: string) => ({ success: true, userId, accessToken: `token-${userId}`, connection: { tokenKind: "user", name: "Conexão" } }),
    }));
    mock.module("./meta-ads-queries", () => ({
      loadClientLabels: async (ids: string[]) => new Map(ids.map(id => [id, { client: id === CLIENT_A ? "Cliente A" : "Cliente B", email: "x@y.com", consultant: null }])),
    }));
    // The real status audit writes the legacy log and then the stream event; the stub does the same.
    mock.module("@/lib/backoffice/meta-status-change-audit", () => ({
      recordStatusChangeAudit: async (input: { objectId: string; appliedToMeta: boolean; note: string }) => {
        audits.push({ kind: "status", id: input.objectId, applied: input.appliedToMeta });
        if (streamDown) return { auditLogFailed: true };
        await client`INSERT INTO meta_tracking_change_events (entity_id, note) VALUES (${input.objectId}, ${input.note})`;
        return { auditLogFailed: false };
      },
    }));
    const realAdminQueries = await import("@/lib/db/admin-queries");
    mock.module("@/lib/db/admin-queries", () => ({
      ...realAdminQueries,
      createCampaignEditLog: async (data: { campaignId: string; appliedToMeta: boolean }) => {
        audits.push({ kind: "budget", id: data.campaignId, applied: data.appliedToMeta });
        return { id: `log-${data.campaignId}` };
      },
      createAdSetEditLog: async (data: { adsetId: string; appliedToMeta: boolean }) => {
        audits.push({ kind: "budget", id: data.adsetId, applied: data.appliedToMeta });
        return { id: `log-${data.adsetId}` };
      },
    }));
    mock.module("@/lib/db/meta-tracking-event-queries", () => ({
      recordInternalChangeEvent: async (draft: { entityId: string; note: string | null }) => {
        if (streamDown) return null;
        const [row] = await client`INSERT INTO meta_tracking_change_events (entity_id, note) VALUES (${draft.entityId}, ${draft.note}) RETURNING id`;
        return row.id as string;
      },
    }));

    stub = installMetaFetchStub(async req => {
      if (req.path === "me") return { body: { id: "me" } };
      if (req.path === "me/adaccounts") return { body: { data: [{ id: "act_111", account_id: "111", currency: "BRL" }, { id: "act_222", account_id: "222", currency: "BRL" }] } };
      const fields = req.params.get("fields") ?? "";
      if (req.method === "GET" && req.path === "") {
        const ids = (req.params.get("ids") ?? "").split(",");
        if (ids.some(id => !meta.has(id) || !fits(meta.get(id)!, fields))) return { status: 400, body: graphErrorBody({ message: "Some of the aliases you requested do not exist", code: 100 }) };
        return { body: Object.fromEntries(ids.map(id => [id, { ...meta.get(id) }])) };
      }
      const object = meta.get(req.path);
      if (!object || (req.method === "GET" && !fits(object, fields))) return { status: 400, body: graphErrorBody({ message: "Unsupported get request", code: 100 }) };
      if (req.method === "GET") return { body: { ...object } };
      await onWrite(object.id);
      const failure = writeFailures.get(object.id);
      if (failure) return { status: 400, body: graphErrorBody({ message: failure === 17 ? "User request limit reached" : "Invalid parameter", code: failure }) };
      const status = req.params.get("status");
      const budget = req.params.get("daily_budget");
      if (status) Object.assign(object, { status, effective_status: status });
      if (budget) object.daily_budget = budget;
      if (lostResponses.has(object.id)) throw new TypeError("fetch failed: ECONNRESET");
      return { body: { success: true } };
    });
    batch = await import("./meta-batch");
  });

  afterAll(async () => {
    stub?.restore();
    await client?.end();
    if (adminUrl && isLocal) {
      const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
      await admin.unsafe(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
      await admin.end();
    }
  });

  const writes = () => stub.calls.filter(c => c.method === "POST");
  const preview = (items: Parameters<typeof batch.previewMetaBatch>[1]["items"], note = "CPA alto na semana") =>
    batch.previewMetaBatch(actor as never, { note, items }, ORIGIN);
  const run = (id: string, who: unknown = actor) => batch.runMetaBatch(who as never, id);

  it("previews many clients without writing, runs once on approval, and records each change", async () => {
    resetMeta();
    const before = writes().length;
    const p = await preview([
      { userId: CLIENT_A, level: "campaign", id: "101", action: "pause" },
      { userId: CLIENT_A, level: "campaign", id: "102", action: "set_daily_budget", dailyBudget: 45 },
      { userId: CLIENT_B, level: "campaign", id: "201", action: "pause" },
      { userId: CLIENT_A, level: "campaign", id: "999", action: "pause" },
    ]);
    assert.equal(writes().length, before, "preview never writes to Meta");
    assert.ok(p.batchId);
    assert.equal(p.approvalUrl, `${ORIGIN}/lotes/${p.batchId}`);
    assert.deepEqual([p.summary.toRun, p.summary.skipped], [2, 2]);
    assert.match(String(p.items[2]?.skipped), /pausado/);
    assert.match(String(p.items[3]?.skipped), /conta de anúncio deste cliente/);
    assert.deepEqual([p.items[1]?.from, p.items[1]?.to], [30, 45]);

    const result = await run(p.batchId!);
    assert.equal(result.status, "done");
    assert.deepEqual([result.summary.applied, result.summary.failed], [2, 0]);
    assert.equal(meta.get("101")?.status, "PAUSED");
    assert.equal(meta.get("102")?.daily_budget, "4500");
    assert.equal(meta.get("999")?.status, "ACTIVE");
    assert.deepEqual(audits.map(a => [a.kind, a.id, a.applied]).sort(), [["budget", "102", true], ["status", "101", true]]);
    await assert.rejects(run(p.batchId!), /já foi executado/);
  });

  it("skips an account that also belongs to a client outside the portfolio", async () => {
    resetMeta();
    await client`INSERT INTO meta_tracking_account_coverage VALUES (${OUTSIDE}, 'act_111', now()::date)`;
    try {
      const p = await preview([{ userId: CLIENT_A, level: "campaign", id: "101", action: "pause" }]);
      assert.equal(p.batchId, null);
      assert.match(String(p.items[0]?.skipped), /fora da sua carteira/);
    } finally {
      await client`DELETE FROM meta_tracking_account_coverage`;
    }
  });

  it("refuses an id sent with the wrong level", async () => {
    resetMeta();
    const p = await preview([{ userId: CLIENT_A, level: "campaign", id: "301", action: "pause" }]);
    assert.match(String(p.items[0]?.skipped), /Não encontrado como campanha/);
  });

  it("runs a batch only once when two approvals race", async () => {
    resetMeta();
    const p = await preview([{ userId: CLIENT_A, level: "campaign", id: "101", action: "pause" }], "pausa geral");
    const before = writes().length;
    onWrite = () => new Promise(resolve => setTimeout(resolve, 80));
    const first = run(p.batchId!);
    await new Promise(resolve => setTimeout(resolve, 20));
    const results = await Promise.allSettled([first, run(p.batchId!)]);
    assert.equal(results[0].status, "fulfilled");
    assert.match(String((results[1] as PromiseRejectedResult).reason), /em execução agora/);
    assert.equal(writes().length - before, 1);
  });

  it("rereads each object right before writing it: a change made during the run is not overwritten", async () => {
    resetMeta();
    const p = await preview([
      { userId: CLIENT_A, level: "campaign", id: "101", action: "set_daily_budget", dailyBudget: 70 },
      { userId: CLIENT_A, level: "campaign", id: "102", action: "set_daily_budget", dailyBudget: 70 },
    ], "ajuste de verba");
    // While the first write is in flight, someone changes the second budget in Ads Manager.
    onWrite = id => { if (id === "101") meta.get("102")!.daily_budget = "6500"; };
    const result = await run(p.batchId!);
    assert.deepEqual([result.summary.applied, result.summary.changedSincePreview], [1, 1]);
    assert.equal(meta.get("102")?.daily_budget, "6500");
  });

  it("reports a Meta refusal per item and keeps the others", async () => {
    resetMeta();
    const p = await preview([
      { userId: CLIENT_A, level: "campaign", id: "101", action: "pause" },
      { userId: CLIENT_A, level: "campaign", id: "102", action: "pause" },
    ], "pausa");
    writeFailures.set("101", 100);
    const result = await run(p.batchId!);
    assert.deepEqual([result.summary.applied, result.summary.failed, result.status], [1, 1, "done"]);
    assert.ok(result.items.find(i => i.id === "101")?.error);
    assert.deepEqual(audits.filter(a => a.id === "101").map(a => a.applied), [false], "a refused write is recorded as not applied");
  });

  it("pauses a client hit by Meta's rate limit and resumes later instead of failing the items", async () => {
    resetMeta();
    const p = await preview([
      { userId: CLIENT_A, level: "campaign", id: "101", action: "pause" },
      { userId: CLIENT_B, level: "campaign", id: "201", action: "activate" },
    ], "troca de verba");
    writeFailures.set("101", 17);
    const partial = await run(p.batchId!);
    assert.equal(partial.status, "partial");
    assert.deepEqual([partial.summary.applied, partial.summary.pending, partial.summary.failed], [1, 1, 0]);
    assert.match(partial.notes.join(" "), /limitou as chamadas/);
    writeFailures.clear();
    const done = await run(p.batchId!);
    assert.equal(done.status, "done");
    assert.equal(meta.get("101")?.status, "PAUSED");
  });

  it("recognises and records a write whose run died right after reaching Meta", async () => {
    resetMeta();
    const p = await preview([{ userId: CLIENT_A, level: "campaign", id: "101", action: "pause" }], "pausa");
    // The POST lands, then the run loses the batch before saving the outcome (as if the function was killed).
    onWrite = async () => {
      await client`UPDATE meta_ads_batches SET run_id = NULL WHERE id = ${p.batchId!}`;
    };
    await assert.rejects(run(p.batchId!), /Outra execução assumiu/);
    assert.equal(meta.get("101")?.status, "PAUSED");
    assert.equal(audits.length, 0);
    onWrite = () => {};
    await client`UPDATE meta_ads_batches SET lease_until = now() - interval '1 second' WHERE id = ${p.batchId!}`;
    const before = writes().length;
    const result = await run(p.batchId!);
    assert.deepEqual([result.status, result.summary.applied, result.summary.alreadyApplied], ["done", 1, 0]);
    assert.equal(writes().length, before, "nothing is written again");
    assert.deepEqual(audits.map(a => [a.id, a.applied]), [["101", true]], "recorded exactly once");
  });

  it("stops a run that lost the batch to a newer one, so nothing is recorded twice", async () => {
    resetMeta();
    const p = await preview([{ userId: CLIENT_A, level: "campaign", id: "101", action: "pause" }], "pausa");
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    onWrite = id => (id === "101" && !meta.get("101")!.name.endsWith("*") ? (meta.get("101")!.name += "*", gate) : undefined);
    const stale = run(p.batchId!);
    await new Promise(resolve => setTimeout(resolve, 50));
    // The stale run is stuck inside Meta; its lease expires and a new approval takes over.
    await client`UPDATE meta_ads_batches SET lease_until = now() - interval '1 second' WHERE id = ${p.batchId!}`;
    const fresh = await run(p.batchId!);
    release();
    await assert.rejects(stale, /Outra execução assumiu/);
    assert.equal(fresh.status, "done");
    assert.deepEqual(audits.map(a => a.id), ["101"], "only the run that owns the batch records it");
    const [row] = await client`SELECT status FROM meta_ads_batches WHERE id = ${p.batchId!}`;
    assert.equal(row.status, "done");
  });

  it("reconciles a write whose response was lost by rereading, instead of calling it a failure", async () => {
    resetMeta();
    const p = await preview([{ userId: CLIENT_A, level: "campaign", id: "101", action: "pause" }], "pausa");
    lostResponses.add("101");
    const result = await run(p.batchId!);
    assert.deepEqual([result.status, result.summary.applied, result.summary.failed], ["done", 1, 0]);
    assert.deepEqual(audits.map(a => [a.id, a.applied]), [["101", true]]);
  });

  it("keeps the batch open until the history really records the change", async () => {
    resetMeta();
    const p = await preview([{ userId: CLIENT_A, level: "campaign", id: "102", action: "set_daily_budget", dailyBudget: 40 }], "verba");
    streamDown = true;
    const partial = await run(p.batchId!);
    assert.equal(partial.status, "partial");
    assert.equal(partial.summary.auditPending, 1);
    streamDown = false;
    const before = writes().length;
    const done = await run(p.batchId!);
    assert.equal(done.status, "done");
    assert.equal(writes().length, before, "the Meta change is not repeated, only the record");
  });

  it("does not record twice when a run dies between recording and marking it done", async () => {
    resetMeta();
    const p = await preview([{ userId: CLIENT_A, level: "campaign", id: "101", action: "pause" }], "pausa");
    await run(p.batchId!);
    // Simulate the crash window: the record exists but the item still says the record is pending.
    await client`UPDATE meta_ads_batches SET status = 'partial', items = jsonb_set(items, '{0,audit}', '"failed"') WHERE id = ${p.batchId!}`;
    const [{ count: before }] = await client`SELECT count(*)::int AS count FROM meta_tracking_change_events WHERE entity_id = '101'`;
    const result = await run(p.batchId!);
    assert.equal(result.status, "done");
    const [{ count: after }] = await client`SELECT count(*)::int AS count FROM meta_tracking_change_events WHERE entity_id = '101'`;
    assert.equal(after, before);
  });

  it("tells the AI and the screen what can be done next, including a run that died", async () => {
    resetMeta();
    const p = await preview([{ userId: CLIENT_A, level: "campaign", id: "101", action: "pause" }], "pausa");
    const next = async () => batch.batchAction((await batch.getMetaBatch(actor as never, p.batchId!)).row);
    assert.equal(await next(), "approve");
    await client`UPDATE meta_ads_batches SET status = 'running', confirmed_at = now(), lease_until = now() - interval '1 second' WHERE id = ${p.batchId!}`;
    assert.equal(await next(), "resume");
    await client`UPDATE meta_ads_batches SET lease_until = now() + interval '1 minute' WHERE id = ${p.batchId!}`;
    assert.equal(await next(), null);
    await assert.rejects(run(p.batchId!), /em execução agora/);
    await client`UPDATE meta_ads_batches SET status = 'previewed', confirmed_at = NULL, lease_until = NULL, expires_at = now() - interval '1 minute' WHERE id = ${p.batchId!}`;
    assert.equal(await next(), null);
  });

  it("refuses clients outside the portfolio, someone else's batch, expired previews and allowlist-only admins", async () => {
    resetMeta();
    await assert.rejects(preview([{ userId: OUTSIDE, level: "campaign", id: "101", action: "pause" }]), /Fora da sua carteira/);
    await assert.rejects(
      batch.previewMetaBatch({ ...actor, id: "admin:x@y.com", role: "admin", source: "allowlist" } as never, { note: "pausa", items: [{ userId: CLIENT_A, level: "campaign", id: "101", action: "pause" }] }, ORIGIN),
      /Cadastre seu usuário/,
    );
    const p = await preview([{ userId: CLIENT_A, level: "campaign", id: "101", action: "pause" }], "pausa");
    const [other] = await client`INSERT INTO backoffice_users (email) VALUES ('outro@automatize.com') RETURNING id`;
    await assert.rejects(run(p.batchId!, { ...actor, id: other.id }), /só quem gerou a prévia/);
    await client`UPDATE meta_ads_batches SET expires_at = now() - interval '1 minute' WHERE id = ${p.batchId!}`;
    await assert.rejects(run(p.batchId!), /prévia venceu/);
    assert.equal(meta.get("101")?.status, "ACTIVE");
  });
});
