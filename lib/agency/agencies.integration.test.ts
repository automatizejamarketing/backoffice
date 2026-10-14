/**
 * Isolamento entre agências contra um Postgres de verdade (ADR 0044/0045). Roda só com
 * AGENCY_TEST_URL apontando para um banco descartável, sozinho:
 *
 *   AGENCY_TEST_URL=postgres://postgres@localhost:55433/postgres bun test lib/agency/agencies.integration.test.ts
 *
 * Cria o banco `agency_it`, as tabelas mínimas e aplica a migration 0136 de verdade.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
// @ts-expect-error Bun's runtime mock API is absent from this repository's test declarations.
import { mock } from "bun:test";
import postgres from "postgres";

const BASE_URL = process.env.AGENCY_TEST_URL;
const DB_NAME = "agency_it";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({
  revalidateTag: () => {},
  revalidatePath: () => {},
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

type Lib = typeof import("./agencies");
type Users = typeof import("@/lib/auth/backoffice-users");
type Rbac = typeof import("@/lib/db/backoffice-rbac-queries");
type Core = typeof import("@/lib/auth/rbac-core");

describe("agências: isolamento no banco", { skip: !BASE_URL }, () => {
  let sql: ReturnType<typeof postgres>;
  let lib: Lib;
  let users: Users;
  let rbac: Rbac;
  let core: Core;

  const ids = {
    agencyA: "a0000000-0000-4000-8000-00000000000a",
    agencyB: "b0000000-0000-4000-8000-00000000000b",
    ownerA: "a1000000-0000-4000-8000-000000000001",
    memberA: "a2000000-0000-4000-8000-000000000002",
    ownerB: "b1000000-0000-4000-8000-000000000001",
    consultant: "c0000000-0000-4000-8000-000000000001",
    premium: "c0000000-0000-4000-8000-000000000002",
    admin: "c0000000-0000-4000-8000-000000000003",
    client1: "d0000000-0000-4000-8000-000000000001",
    client2: "d0000000-0000-4000-8000-000000000002",
    client3: "d0000000-0000-4000-8000-000000000003",
    houseClient: "d0000000-0000-4000-8000-000000000004",
  };

  before(async () => {
    const admin = postgres(BASE_URL!, { max: 1 });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    await admin.end();
    const url = new URL(BASE_URL!);
    url.pathname = `/${DB_NAME}`;
    process.env.POSTGRES_URL = url.toString();
    sql = postgres(url.toString(), { max: 1 });
    await sql.unsafe(`
      CREATE TABLE users (id uuid PRIMARY KEY, email varchar(64) NOT NULL UNIQUE, name text);
      CREATE TABLE companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
      CREATE TABLE user_companies (user_id uuid, company_id uuid, created_at timestamp DEFAULT now());
      CREATE TABLE backoffice_users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(100) NOT NULL UNIQUE, name varchar(100),
        role varchar NOT NULL DEFAULT 'marketing_consultant', sales_role varchar(32), active boolean NOT NULL DEFAULT true,
        created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE ambassador_members (user_id uuid PRIMARY KEY, can_grant_starter boolean NOT NULL DEFAULT false);
      CREATE TABLE user_marketing_consultants (
        user_id uuid PRIMARY KEY REFERENCES users(id), consultant_id uuid NOT NULL REFERENCES backoffice_users(id),
        assigned_by_email varchar(100) NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE backoffice_audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_email varchar(100) NOT NULL, target_user_id uuid NOT NULL REFERENCES users(id),
        action varchar(50) NOT NULL, field_name varchar(50) NOT NULL, old_value text, new_value text NOT NULL, note text,
        created_at timestamp NOT NULL DEFAULT now());
    `);
    const migration = readFileSync(join(import.meta.dir, "../db/migrations/0136_agencies.sql"), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) await sql.unsafe(statement);

    lib = await import("./agencies");
    users = await import("@/lib/auth/backoffice-users");
    rbac = await import("@/lib/db/backoffice-rbac-queries");
    core = await import("@/lib/auth/rbac-core");
  });

  after(async () => {
    const { postgresClient } = await import("@/lib/db");
    await postgresClient.end();
    await sql?.end();
  });

  beforeEach(async () => {
    await sql.unsafe(`TRUNCATE backoffice_audit_logs, user_marketing_consultants, agency_clients, ambassador_members, backoffice_users, agencies, users CASCADE`);
    await sql`INSERT INTO agencies (id, name) VALUES (${ids.agencyA}, 'Infinite'), (${ids.agencyB}, 'Outra')`;
    await sql`INSERT INTO users (id, email) VALUES
      (${ids.client1}, 'c1@x.com'), (${ids.client2}, 'c2@x.com'), (${ids.client3}, 'c3@x.com'), (${ids.houseClient}, 'casa@x.com')`;
    await sql`INSERT INTO backoffice_users (id, email, role, agency_id) VALUES
      (${ids.ownerA}, 'dono@infinite.com', 'agency_owner', ${ids.agencyA}),
      (${ids.memberA}, 'membro@infinite.com', 'agency_member', ${ids.agencyA}),
      (${ids.ownerB}, 'dono@outra.com', 'agency_owner', ${ids.agencyB})`;
    await sql`INSERT INTO backoffice_users (id, email, role) VALUES
      (${ids.consultant}, 'consultor@automatize.com', 'marketing_consultant'),
      (${ids.premium}, 'premium@automatize.com', 'marketing_consultant_premium'),
      (${ids.admin}, 'admin@automatize.com', 'admin')`;
    await sql`INSERT INTO agency_clients (user_id, agency_id, added_by_email) VALUES
      (${ids.client1}, ${ids.agencyA}, 't'), (${ids.client2}, ${ids.agencyA}, 't'), (${ids.client3}, ${ids.agencyB}, 't')`;
    await sql`INSERT INTO user_marketing_consultants (user_id, consultant_id, assigned_by_email) VALUES
      (${ids.client1}, ${ids.memberA}, 't'), (${ids.houseClient}, ${ids.consultant}, 't')`;
  });

  const actor = async (email: string) => {
    const found = await users.getBackofficeActorByEmail(email);
    assert.ok(found, email);
    return found;
  };

  it("Dono vê todos os clientes da agência; Membro, só os atribuídos; outra agência, nenhum", async () => {
    const owner = await actor("dono@infinite.com");
    const member = await actor("membro@infinite.com");
    const other = await actor("dono@outra.com");
    assert.deepEqual([...(owner.assignedUserIds ?? [])].sort(), [ids.client1, ids.client2]);
    assert.deepEqual(member.assignedUserIds, [ids.client1]);
    assert.deepEqual(other.assignedUserIds, [ids.client3]);
    assert.equal(core.canAccessMarketingUser(other, ids.client1), false);
    assert.equal(core.canAccessMarketingUser(owner, ids.houseClient), false);
  });

  it("equipe interna não vê clientes de agência, exceto o admin", async () => {
    const premium = await actor("premium@automatize.com");
    const consultant = await actor("consultor@automatize.com");
    assert.equal(core.canAccessMarketingUser(premium, ids.client1), false);
    assert.equal(core.canAccessMarketingUser(premium, ids.houseClient), true);
    assert.deepEqual(consultant.assignedUserIds, [ids.houseClient]);
    // Mesmo com atribuição antiga a um cliente que virou de agência, ele sai da carteira interna.
    await sql`UPDATE user_marketing_consultants SET consultant_id = ${ids.consultant} WHERE user_id = ${ids.client1}`;
    assert.deepEqual((await actor("consultor@automatize.com")).assignedUserIds, [ids.houseClient]);
    // O admin entra pelo ADMIN_EMAILS ou pelo banco; pelo banco, sem lista de escondidos.
    const admin = await users.getBackofficeActorByEmail("admin@automatize.com");
    if (admin?.role === "admin") assert.equal(core.canAccessMarketingUser(admin, ids.client1), true);
  });

  it("agência arquivada não entra", async () => {
    await sql`UPDATE agencies SET archived_at = now() WHERE id = ${ids.agencyA}`;
    assert.equal(await users.getBackofficeActorByEmail("dono@infinite.com"), null);
    assert.equal(await users.getBackofficeActorByEmail("membro@infinite.com"), null);
  });

  it("atribuição: cliente de agência só para gente da mesma agência; cliente da casa só para consultor interno", async () => {
    const assign = (userId: string, consultantId: string) =>
      rbac.setMarketingConsultantAssignment({ userId, consultantId, assignedByEmail: "t@x.com" });
    await assert.rejects(assign(ids.client2, ids.consultant), /invalid_consultant/);
    await assert.rejects(assign(ids.client2, ids.ownerB), /invalid_consultant/);
    await assert.rejects(assign(ids.houseClient, ids.memberA), /invalid_consultant/);
    await assign(ids.client2, ids.memberA);
    assert.deepEqual([...((await actor("membro@infinite.com")).assignedUserIds ?? [])].sort(), [ids.client1, ids.client2]);
  });

  it("Dono só gere a própria agência; conta não entra em duas agências", async () => {
    const owner = await actor("dono@infinite.com");
    const other = await actor("dono@outra.com");
    await assert.rejects(lib.getAgencyDetail(other, ids.agencyA), (e: Error & { status?: number }) => e.status === 403);
    await assert.rejects(lib.addAgencyClient(owner, ids.agencyA, "c3@x.com"), /outra agência/);
    await assert.rejects(lib.addAgencyClient(other, ids.agencyA, "casa@x.com"), (e: Error & { status?: number }) => e.status === 403);
    await assert.rejects(lib.addAgencyPerson(owner, ids.agencyA, { email: "dono@outra.com", role: "agency_member" }), /já tem acesso/);
  });

  it("adicionar cliente da casa tira a atribuição ao consultor interno e audita; remover não apaga a conta", async () => {
    const owner = await actor("dono@infinite.com");
    await lib.addAgencyClient(owner, ids.agencyA, "  CASA@x.com ");
    const [assignment] = await sql`SELECT 1 FROM user_marketing_consultants WHERE user_id = ${ids.houseClient}`;
    assert.equal(assignment, undefined);
    assert.equal((await actor("consultor@automatize.com")).assignedUserIds?.length, 0);
    const audits = await sql`SELECT action FROM backoffice_audit_logs WHERE target_user_id = ${ids.houseClient}`;
    assert.deepEqual(audits.map((a) => a.action), ["agency_client_added"]);

    await lib.removeAgencyClient(owner, ids.agencyA, ids.client1);
    const [still] = await sql`SELECT 1 FROM users WHERE id = ${ids.client1}`;
    assert.ok(still);
    assert.deepEqual((await actor("membro@infinite.com")).assignedUserIds, []);
  });

  it("tirar uma pessoa da agência tira o acesso e solta os clientes dela", async () => {
    const owner = await actor("dono@infinite.com");
    await assert.rejects(lib.removeAgencyPerson(owner, ids.agencyA, ids.ownerA), /a si mesmo/);
    await assert.rejects(lib.removeAgencyPerson(owner, ids.agencyA, ids.ownerB), (e: Error & { status?: number }) => e.status === 404);
    await lib.removeAgencyPerson(owner, ids.agencyA, ids.memberA);
    assert.equal(await users.getBackofficeActorByEmail("membro@infinite.com"), null);
    const [left] = await sql`SELECT 1 FROM user_marketing_consultants WHERE user_id = ${ids.client1}`;
    assert.equal(left, undefined);
  });
});
