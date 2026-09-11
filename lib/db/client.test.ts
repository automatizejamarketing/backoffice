import assert from "node:assert/strict";
import { test } from "node:test";
import postgres from "postgres";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";

// Explicit local-only integration check; never connects to production.
const testUrl = process.env.DB_POOL_TEST_URL;
test("pool preserves transactions, queues work, releases idle clients and reconnects", { skip: !testUrl, timeout: 15000 }, async () => {
  assert.equal(testUrl, "postgres:///postgres");
  assert.equal(process.env.PGHOST, "/tmp/automatize-release-socket-20260910");
  process.env.POSTGRES_URL = testUrl;
  const observer = postgres(testUrl!, { max: 1 });
  const modulePath = new URL("./client.ts", import.meta.url).href;
  const { postgresClient: client } = await import(modulePath);
  const { postgresClient: reloaded } = await import(`${modulePath}?reload=1`);
  try {
    assert.equal(client, reloaded, "module reload must reuse the existing pool");
    await verifyTransactions(client);
    // Next.js can bundle the CJS entry point; both library copies need the fix.
    const cjsPostgres: typeof postgres = createRequire(import.meta.url)(new URL("../../node_modules/postgres/cjs/src/index.js", import.meta.url).pathname);
    const cjsOptions = { max: 3, max_pipeline: 0, prepare: false };
    const cjsClient = cjsPostgres(testUrl!, cjsOptions);
    try {
      await verifyTransactions(cjsClient);
    } finally {
      await cjsClient.end({ timeout: 1 });
    }
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      client`select pg_backend_pid() as pid, ${i}::int as value, pg_sleep(0.05)`));
    assert.deepEqual(results.map(rows => rows[0].value), Array.from({ length: 12 }, (_, i) => i));
    const pids = [...new Set(results.map(rows => rows[0].pid))] as number[];
    assert.ok(pids.length <= 3, "concurrent queries must not open more than three connections");
    const deadline = Date.now() + 8000;
    let remaining = pids.length;
    while (remaining > 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const [row] = await observer`select count(*)::int as n from pg_stat_activity where pid in ${observer(pids)}`;
      remaining = row.n;
    }
    assert.equal(remaining, 0, "idle connections must be released");
    const [row] = await client`select 42 as value`;
    assert.equal(row.value, 42, "pool must reconnect after releasing idle connections");
  } finally {
    await client.end();
    await observer.end();
  }
});

async function verifyTransactions(client: ReturnType<typeof postgres>) {
  const db = drizzle(client);
  const rollback = new Error("expected rollback");
  await db.transaction(async (tx) => {
    await tx.execute(sql`create temporary table checkout_pool_regression (value int) on commit drop`);
    await tx.execute(sql`insert into checkout_pool_regression values (1)`);
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.execute(sql`insert into checkout_pool_regression values (2)`);
      throw rollback;
    }), (error) => error === rollback);
    const rows = await tx.execute(sql`select value from checkout_pool_regression`);
    assert.deepEqual(rows.map(row => row.value), [1], "savepoint must roll back writes");
  });
  await assert.rejects(db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(9112026)`);
    throw rollback;
  }), (error) => error === rollback);
  const transactions = await Promise.all(Array.from({ length: 9 }, () =>
    db.transaction(async (tx) => {
      const [first] = await tx.execute(sql`select pg_backend_pid() as pid, txid_current()::text as xid`);
      const [second] = await tx.execute(sql`select pg_backend_pid() as pid, txid_current()::text as xid, pg_sleep(0.01)`);
      assert.equal(first.pid, second.pid, "transaction must retain its backend");
      assert.equal(first.xid, second.xid, "transaction must retain its snapshot");
      return first.xid;
    })));
  assert.equal(new Set(transactions).size, 9, "concurrent transactions must remain isolated");
  await db.transaction(async (tx) => {
    const [row] = await tx.execute(sql`select pg_try_advisory_xact_lock(9112026) as acquired`);
    assert.equal(row.acquired, true, "rollback must release transaction locks");
  });
}
