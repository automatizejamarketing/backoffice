import assert from "node:assert/strict";
import { test } from "node:test";

// Disposable local Postgres only; uses the real production pool configuration.
// PGHOST=/tmp/automatize-expiration-pg-socket PGPORT=55439 \
// EXPIRATION_DB_TEST=1 bun test lib/backoffice/user-expiration-update.test.ts
test("expiration and audit remain atomic with pipelining disabled", { skip: !process.env.EXPIRATION_DB_TEST }, async () => {
  assert.equal(process.env.PGHOST, "/tmp/automatize-expiration-pg-socket");
  assert.equal(process.env.PGPORT, "55439");
  process.env.POSTGRES_URL = "postgres:///postgres";
  const { postgresClient: client } = await import("../db");
  const { updateUserExpirationWithAudit: update } = await import("./user-field-updates");
  const userId = "00000000-0000-4000-8000-000000000001";
  const adminEmail = "expiration-test@example.com";
  const save = (expirationDateInput: string, email = adminEmail) => update({ userId, expirationDateInput, adminEmail: email });
  try {
    await client`CREATE TABLE users (id uuid PRIMARY KEY, expiration_date timestamptz)`;
    await client`CREATE TABLE backoffice_audit_logs (
      id bigserial PRIMARY KEY, admin_email varchar(100) NOT NULL,
      target_user_id uuid NOT NULL REFERENCES users(id), action text NOT NULL,
      field_name text NOT NULL, old_value text, new_value text NOT NULL
    )`;
    await client`INSERT INTO users (id) VALUES (${userId})`;

    for (const [date, expected] of [
      ["2026-09-10", "2026-09-11T02:59:59.999Z"],
      ["2026-09-17", "2026-09-18T02:59:59.999Z"],
      ["2026-09-16", "2026-09-17T02:59:59.999Z"],
    ]) {
      const result = await save(date);
      assert.equal(result.ok, true);
      const [row] = await client`SELECT expiration_date FROM users WHERE id = ${userId}`;
      assert.equal(new Date(row.expiration_date).toISOString(), expected);
    }
    let audit = await client`SELECT * FROM backoffice_audit_logs ORDER BY id`;
    assert.equal(audit.length, 3);
    assert.equal(audit[0].old_value, null);
    assert.equal(audit[1].old_value, audit[0].new_value);
    assert.equal(audit[2].old_value, audit[1].new_value);
    assert.equal(audit[2].admin_email, adminEmail);
    assert.equal(audit[2].action, "update_expiration_date");

    // An audit failure must roll back the date, not partially extend access.
    await assert.rejects(save("2026-10-01", "x".repeat(101)));
    const [unchanged] = await client`SELECT expiration_date FROM users WHERE id = ${userId}`;
    assert.equal(new Date(unchanged.expiration_date).toISOString(), audit[2].new_value);

    assert.deepEqual(await save("2026-02-30"), { ok: false, error: "invalid_date" });
    assert.deepEqual(await update({ userId: "00000000-0000-4000-8000-000000000002", expirationDateInput: "2026-09-20", adminEmail }), { ok: false, error: "User not found" });

    const results = await Promise.all([save("2026-10-01"), save("2026-10-02"), save("2026-10-03")]);
    assert.ok(results.every(result => result.ok));
    audit = await client`SELECT * FROM backoffice_audit_logs ORDER BY id`;
    assert.equal(audit.length, 6);
    for (let i = 1; i < audit.length; i++) assert.equal(audit[i].old_value, audit[i - 1].new_value);
    const [latest] = await client`SELECT expiration_date FROM users WHERE id = ${userId}`;
    assert.equal(new Date(latest.expiration_date).toISOString(), audit.at(-1)!.new_value);
  } finally {
    await client`DROP TABLE IF EXISTS backoffice_audit_logs, users`;
    await client.end();
  }
});
