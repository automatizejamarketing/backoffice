import assert from "node:assert/strict";
import { test } from "node:test";
import postgres from "postgres";

// Explicit local-only integration check; never connects to production.
const testUrl = process.env.DB_POOL_TEST_URL;
test("pool queues concurrent work, releases idle clients and reconnects", { skip: !testUrl, timeout: 15000 }, async () => {
  assert.equal(testUrl, "postgres:///postgres");
  assert.equal(process.env.PGHOST, "/tmp/automatize-release-socket-20260910");
  process.env.POSTGRES_URL = testUrl;
  const observer = postgres(testUrl!, { max: 1 });
  const modulePath = new URL("./client.ts", import.meta.url).href;
  const { postgresClient: client } = await import(modulePath);
  const { postgresClient: reloaded } = await import(`${modulePath}?reload=1`);
  try {
    assert.equal(client, reloaded, "module reload must reuse the existing pool");
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
