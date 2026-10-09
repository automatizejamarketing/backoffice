import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error Bun's runtime test API is absent from this repository's test declarations.
import { afterAll, beforeAll, describe, it, mock } from "bun:test";
import postgres from "postgres";
import { ensureMetaTestEnv, graphErrorBody, installMetaFetchStub, type MetaFetchStub } from "../../tests/helpers/meta-fetch-stub";

// Explicit local-only integration check against a throwaway database; never connects to staging
// or production. Example:
//   META_BATCH_TEST_URL=postgres://postgres@localhost:55432/postgres bun test lib/mcp/meta-batch.integration.test.ts
const adminUrl = process.env.META_BATCH_TEST_URL;
const isLocal = adminUrl ? /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(adminUrl) : false;
const DATABASE = "meta_batch_it";

const CLIENT_A = "00000000-0000-4000-8000-00000000000a";
const CLIENT_B = "00000000-0000-4000-8000-00000000000b";
const OUTSIDE = "00000000-0000-4000-8000-00000000000c";

type Obj = { id: string; status: string; effective_status: string; account_id: string; daily_budget?: string; campaign_id?: string; name: string };

// bun-test.d.ts only declares what the unit suites use; skipIf is Bun's runtime API.
const describeWithDatabase = (describe as unknown as { skipIf(skip: boolean): typeof describe }).skipIf(!adminUrl);

describeWithDatabase("Meta Ads batch (Postgres + Graph stub)", () => {
  let client: ReturnType<typeof postgres>;
  let batch: typeof import("./meta-batch");
  let stub: MetaFetchStub;
  const audits: unknown[] = [];
  const meta = new Map<string, Obj>();
  let writeFailures = new Set<string>();
  /** Latência simulada da Meta: mantém a primeira execução em andamento enquanto a segunda tenta assumir o lote. */
  let latencyMs = 0;
  let actor: { id: string; email: string; role: "marketing_consultant"; assignedUserIds: string[] };

  function resetMeta() {
    meta.clear();
    writeFailures = new Set();
    // Client A: campaigns in act_111; client B: one campaign in act_222.
    meta.set("101", { id: "101", name: "Vendas A", status: "ACTIVE", effective_status: "ACTIVE", account_id: "111", daily_budget: "5000" });
    meta.set("102", { id: "102", name: "Leads A", status: "ACTIVE", effective_status: "ACTIVE", account_id: "111", daily_budget: "3000" });
    meta.set("201", { id: "201", name: "Vendas B", status: "PAUSED", effective_status: "PAUSED", account_id: "222", daily_budget: "8000" });
    meta.set("999", { id: "999", name: "Outro negócio", status: "ACTIVE", effective_status: "ACTIVE", account_id: "999", daily_budget: "1000" });
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
    await client.unsafe(`CREATE TABLE backoffice_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(100) NOT NULL)`);
    const migration = readFileSync(new URL("../db/migrations/0132_meta_ads_batches.sql", import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) await client.unsafe(statement);
    const [row] = await client`INSERT INTO backoffice_users (email) VALUES ('consultor@automatize.com') RETURNING id`;
    actor = { id: row.id as string, email: "consultor@automatize.com", role: "marketing_consultant", assignedUserIds: [CLIENT_A, CLIENT_B] };

    ensureMetaTestEnv();
    mock.module("server-only", () => ({}));
    mock.module("@/lib/meta-business/get-user-access-token", () => ({
      getUserAccessTokenByUserId: async (userId: string) => ({ success: true, userId, accessToken: `token-${userId}`, connection: { tokenKind: "user", name: "Conexão" } }),
    }));
    mock.module("./meta-ads-queries", () => ({
      loadClientLabels: async (ids: string[]) => new Map(ids.map(id => [id, { client: id === CLIENT_A ? "Cliente A" : "Cliente B", email: "x@y.com", consultant: null }])),
    }));
    mock.module("@/lib/backoffice/meta-status-change-audit", () => ({
      recordStatusChangeAudit: async (input: unknown) => { audits.push(input); return { auditLogFailed: false }; },
    }));
    mock.module("@/lib/db/meta-tracking-event-queries", () => ({
      recordInternalChangeEvent: async (draft: unknown) => { audits.push(draft); return "event-id"; },
    }));

    stub = installMetaFetchStub(async req => {
      if (latencyMs) await new Promise(resolve => setTimeout(resolve, latencyMs));
      if (req.path === "me") return { body: { id: "me" } };
      if (req.path === "me/adaccounts") return { body: { data: [{ id: "act_111", account_id: "111", currency: "BRL" }, { id: "act_222", account_id: "222", currency: "BRL" }] } };
      if (req.method === "GET" && req.path === "") {
        const ids = (req.params.get("ids") ?? "").split(",");
        if (ids.some(id => !meta.has(id))) return { status: 400, body: graphErrorBody({ message: "Some of the aliases you requested do not exist", code: 100 }) };
        return { body: Object.fromEntries(ids.map(id => [id, { ...meta.get(id) }])) };
      }
      const object = meta.get(req.path);
      if (!object) return { status: 400, body: graphErrorBody({ message: "Unsupported get request", code: 100 }) };
      if (req.method === "GET") return { body: { ...object } };
      if (writeFailures.has(object.id)) return { status: 400, body: graphErrorBody({ message: "Invalid parameter", code: 100 }) };
      const status = req.params.get("status");
      const budget = req.params.get("daily_budget");
      if (status) Object.assign(object, { status, effective_status: status });
      if (budget) object.daily_budget = budget;
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

  it("previews many clients, confirms once, and records each change", async () => {
    resetMeta();
    audits.length = 0;
    const before = writes().length;
    const preview = await batch.previewMetaBatch(actor as never, {
      note: "CPA alto na semana",
      items: [
        { userId: CLIENT_A, level: "campaign", id: "101", action: "pause" },
        { userId: CLIENT_A, level: "campaign", id: "102", action: "set_daily_budget", dailyBudget: 45 },
        { userId: CLIENT_B, level: "campaign", id: "201", action: "pause" },
        { userId: CLIENT_A, level: "campaign", id: "999", action: "pause" },
      ],
    });
    assert.equal(writes().length, before, "preview never writes to Meta");
    assert.ok(preview.batchId);
    assert.deepEqual([preview.summary.toRun, preview.summary.skipped], [2, 2]);
    assert.match(String(preview.items[2]?.skipped), /pausado/);
    assert.match(String(preview.items[3]?.skipped), /Não encontrado|conta de anúncio/);
    assert.deepEqual([preview.items[1]?.from, preview.items[1]?.to], [30, 45]);

    const result = await batch.confirmMetaBatch(actor as never, preview.batchId!);
    assert.equal(result.status, "done");
    assert.deepEqual([result.summary.applied, result.summary.failed], [2, 0]);
    assert.equal(meta.get("101")?.status, "PAUSED");
    assert.equal(meta.get("102")?.daily_budget, "4500");
    assert.equal(meta.get("999")?.status, "ACTIVE", "object outside the client's accounts is untouched");
    assert.equal(audits.length, 2);
    assert.match(JSON.stringify(audits), /CPA alto na semana \[lote/);

    await assert.rejects(batch.confirmMetaBatch(actor as never, preview.batchId!), /já foi executado/);
  });

  it("runs a batch only once when two confirmations race", async () => {
    resetMeta();
    const preview = await batch.previewMetaBatch(actor as never, {
      note: "pausa geral", items: [{ userId: CLIENT_A, level: "campaign", id: "101", action: "pause" }],
    });
    const before = writes().length;
    latencyMs = 50;
    const first = batch.confirmMetaBatch(actor as never, preview.batchId!);
    await new Promise(resolve => setTimeout(resolve, 20));
    const results = await Promise.allSettled([first, batch.confirmMetaBatch(actor as never, preview.batchId!)]);
    latencyMs = 0;
    assert.equal(results[0].status, "fulfilled");
    assert.match(String((results[1] as PromiseRejectedResult).reason), /em execução agora/);
    assert.equal(writes().length - before, 1);
  });

  it("skips an object changed after the preview instead of overwriting it", async () => {
    resetMeta();
    const preview = await batch.previewMetaBatch(actor as never, {
      note: "ajuste de verba", items: [{ userId: CLIENT_A, level: "campaign", id: "101", action: "set_daily_budget", dailyBudget: 70 }],
    });
    meta.get("101")!.daily_budget = "6500"; // someone changed it in Ads Manager meanwhile
    const result = await batch.confirmMetaBatch(actor as never, preview.batchId!);
    assert.equal(result.summary.changedSincePreview, 1);
    assert.equal(meta.get("101")?.daily_budget, "6500");
  });

  it("reports a Meta refusal per item and keeps the others", async () => {
    resetMeta();
    const preview = await batch.previewMetaBatch(actor as never, {
      note: "pausa", items: [
        { userId: CLIENT_A, level: "campaign", id: "101", action: "pause" },
        { userId: CLIENT_A, level: "campaign", id: "102", action: "pause" },
      ],
    });
    writeFailures.add("101");
    const result = await batch.confirmMetaBatch(actor as never, preview.batchId!);
    assert.deepEqual([result.summary.applied, result.summary.failed], [1, 1]);
    assert.equal(result.status, "done");
    const failed = result.items.find(i => i.id === "101");
    assert.equal(failed?.outcome, "failed");
    assert.ok(failed?.error);
  });

  it("refuses clients outside the portfolio, someone else's batch and expired previews", async () => {
    resetMeta();
    await assert.rejects(
      batch.previewMetaBatch(actor as never, { note: "pausa", items: [{ userId: OUTSIDE, level: "campaign", id: "101", action: "pause" }] }),
      /Fora da sua carteira/,
    );
    const preview = await batch.previewMetaBatch(actor as never, {
      note: "pausa", items: [{ userId: CLIENT_A, level: "campaign", id: "101", action: "pause" }],
    });
    const [other] = await client`INSERT INTO backoffice_users (email) VALUES ('outro@automatize.com') RETURNING id`;
    await assert.rejects(batch.confirmMetaBatch({ ...actor, id: other.id } as never, preview.batchId!), /Lote não encontrado/);
    await client`UPDATE meta_ads_batches SET expires_at = now() - interval '1 minute' WHERE id = ${preview.batchId!}`;
    await assert.rejects(batch.confirmMetaBatch(actor as never, preview.batchId!), /prévia venceu/);
    assert.equal(meta.get("101")?.status, "ACTIVE");
  });

  it("resumes a partial batch without repeating what was already applied", async () => {
    resetMeta();
    const preview = await batch.previewMetaBatch(actor as never, {
      note: "pausa", items: [
        { userId: CLIENT_A, level: "campaign", id: "101", action: "pause" },
        { userId: CLIENT_A, level: "campaign", id: "102", action: "pause" },
      ],
    });
    // Simulate a call cut short after the first item: it reached Meta but has no outcome yet.
    meta.get("101")!.status = "PAUSED";
    await client`UPDATE meta_ads_batches SET status = 'partial', confirmed_at = now() WHERE id = ${preview.batchId!}`;
    const before = writes().length;
    const result = await batch.confirmMetaBatch(actor as never, preview.batchId!);
    assert.equal(result.status, "done");
    assert.deepEqual([result.summary.alreadyApplied, result.summary.applied], [1, 1]);
    assert.equal(writes().length - before, 1, "only the item still pending was written");
  });
});
