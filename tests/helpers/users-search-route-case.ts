import assert from "node:assert/strict";
import * as bunTest from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { user } from "../../lib/db/schema";

const { mock } = bunTest as unknown as {
  mock: { module(specifier: string, factory: () => unknown): void };
};

// Runs in its own process: `mock.module` is global and would leak into the
// rest of the suite.
process.env.POSTGRES_URL = "postgres://test:test@127.0.0.1:1/test";

// The row as it sits in `users`: the search answers the browser, so only the
// columns the pickers render may leave the server.
const storedUser: Record<string, unknown> = {
  id: "00000000-0000-4000-8000-000000000301",
  email: "cliente@example.test",
  name: "Cliente Teste",
  password: "$2b$10$hash-que-nunca-sai-do-servidor",
  authProvider: "credentials",
  phone: "11999999999",
  stripeCustomerId: "cus_interno",
  registryCode: "12345678900",
  expirationDate: new Date("2026-12-31T00:00:00Z"),
  credits: 999,
  referredByAffiliateId: "00000000-0000-4000-8000-000000000302",
};

const columns = getTableColumns(user);
const selects: Array<Record<string, unknown> | undefined> = [];

// Same projection rule as drizzle: `select()` returns the whole row,
// `select({ key: column })` returns only those keys.
const fakeDb = {
  select(fields?: Record<string, unknown>) {
    selects.push(fields);
    const row = fields
      ? Object.fromEntries(
          Object.entries(fields).map(([key, column]) => {
            const property = Object.keys(columns).find(
              (name) => columns[name as keyof typeof columns] === column,
            );
            assert.ok(property, `selected a column outside users: ${key}`);
            return [key, storedUser[property]];
          }),
        )
      : storedUser;
    const query = {
      from: () => query,
      where: () => query,
      limit: async () => [row],
    };
    return query;
  },
};

mock.module("@/lib/db", () => ({ db: fakeDb }));

const permissions: string[] = [];
let allowed = true;

mock.module("@/lib/auth/rbac", () => ({
  requireBackofficePermissionResponse: async (permission: string) => {
    permissions.push(permission);
    if (!allowed) {
      return {
        ok: false,
        response: Response.json({ error: "Forbidden" }, { status: 403 }),
      };
    }
    return {
      ok: true,
      actor: { id: "admin", email: "admin@example.test", role: "admin" },
    };
  },
}));

const { GET } = await import("../../app/api/users/search/route");

function search(q: string) {
  return GET(new Request(`http://localhost/api/users/search?q=${encodeURIComponent(q)}`));
}

// Without users:read: refused before touching the database.
allowed = false;
const denied = await search("cliente");
assert.equal(denied.status, 403);
assert.deepEqual(permissions, ["users:read"]);
assert.equal(selects.length, 0, "no query without users:read");
allowed = true;

// Fewer than 3 characters: empty array, no query.
const short = await search("cl");
assert.equal(short.status, 200);
assert.deepEqual(await short.json(), []);
assert.equal(selects.length, 0, "no query below 3 characters");

// A match carries only what the pickers render.
const found = await search("cliente");
assert.equal(found.status, 200);
const raw = await found.text();
assert.deepEqual(JSON.parse(raw), [
  { id: storedUser.id, email: storedUser.email, name: storedUser.name },
]);
for (const secret of ["hash-que-nunca-sai-do-servidor", "cus_interno", "12345678900"]) {
  assert.ok(!raw.includes(secret), `search leaked ${secret} to the browser`);
}
