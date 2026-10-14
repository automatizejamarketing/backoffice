/**
 * Isolamento entre agências contra um Postgres de verdade (ADR 0044/0045). Roda só com
 * AGENCY_TEST_URL apontando para um banco descartável, sozinho:
 *
 *   AGENCY_TEST_URL=postgres://postgres@localhost:55433/postgres bun test lib/agency/agencies.integration.test.ts
 *
 * Cria o banco `agency_it`, as tabelas mínimas e aplica as migrations 0136 a 0138 de verdade. O Stripe
 * é um dublê em memória.
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
// Dublê do Stripe: a assinatura que `retrieve` devolve é a de `stripeState.subscriptions`.
const stripeState: { subscriptions: Record<string, unknown> } = { subscriptions: {} };
mock.module("@/lib/stripe", () => ({
  stripe: {
    subscriptions: {
      retrieve: async (id: string) => {
        const found = stripeState.subscriptions[id];
        if (!found) throw new Error(`assinatura ${id} não existe no dublê`);
        return found;
      },
    },
  },
}));
mock.module("next/cache", () => ({
  revalidateTag: () => {},
  revalidatePath: () => {},
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

type Lib = typeof import("./agencies");
type Plan = typeof import("./plan");
type Users = typeof import("@/lib/auth/backoffice-users");
type Rbac = typeof import("@/lib/db/backoffice-rbac-queries");
type Core = typeof import("@/lib/auth/rbac-core");

describe("agências: isolamento no banco", { skip: !BASE_URL }, () => {
  let sql: ReturnType<typeof postgres>;
  let lib: Lib;
  let plan: Plan;
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
      CREATE TABLE users (id uuid PRIMARY KEY, email varchar(64) NOT NULL UNIQUE, name text, expiration_date timestamptz);
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
    // 0137 (ClickUp): tirar um cliente cancela os posts dele vindos do ClickUp.
    await sql.unsafe(`CREATE TABLE scheduled_posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid())`);
    for (const file of ["0136_agencies.sql", "0137_clickup_publishing.sql", "0138_agency_plan.sql"]) {
      const migration = readFileSync(join(process.cwd(), "lib/db/migrations", file), "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) await sql.unsafe(statement);
    }

    lib = await import("./agencies");
    plan = await import("./plan");
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
    await sql.unsafe(`TRUNCATE clickup_task_posts, backoffice_audit_logs, user_marketing_consultants, agency_clients, ambassador_members, backoffice_users, agencies, users CASCADE`);
    stripeState.subscriptions = {};
    await sql`INSERT INTO agencies (id, name, plan_client_limit) VALUES (${ids.agencyA}, 'Infinite', 5), (${ids.agencyB}, 'Outra', 5)`;
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

  const admin = { id: ids.admin, email: "admin@automatize.com", role: "admin", source: "database" } as const;

  it("Dono só gere a própria agência; conta não entra em duas agências", async () => {
    const owner = await actor("dono@infinite.com");
    const other = await actor("dono@outra.com");
    await assert.rejects(lib.getAgencyDetail(other, ids.agencyA), (e: Error & { status?: number }) => e.status === 403);
    await assert.rejects(lib.addAgencyClient(admin, ids.agencyA, "c3@x.com"), /outra agência/);
    await assert.rejects(lib.addAgencyClient(other, ids.agencyA, "casa@x.com"), (e: Error & { status?: number }) => e.status === 403);
    await assert.rejects(lib.addAgencyPerson(owner, ids.agencyA, { email: "dono@outra.com", role: "agency_member" }), /Não foi possível dar acesso/);
  });

  it("Dono não puxa conta para a agência só sabendo o e-mail; só o admin liga", async () => {
    const owner = await actor("dono@infinite.com");
    await assert.rejects(lib.addAgencyClient(owner, ids.agencyA, "casa@x.com"), (e: Error & { status?: number }) => e.status === 403);
    const [linked] = await sql`SELECT 1 FROM agency_clients WHERE user_id = ${ids.houseClient}`;
    assert.equal(linked, undefined);
  });

  it("adicionar cliente da casa tira a atribuição ao consultor interno e audita; remover não apaga a conta", async () => {
    const owner = await actor("dono@infinite.com");
    await lib.addAgencyClient(admin, ids.agencyA, "  CASA@x.com ");
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

  it("duas remoções de Dono ao mesmo tempo não deixam a agência sem Dono", async () => {
    await sql`INSERT INTO backoffice_users (email, role, agency_id) VALUES ('dono2@infinite.com', 'agency_owner', ${ids.agencyA})`;
    const [{ id: owner2 }] = await sql`SELECT id FROM backoffice_users WHERE email = 'dono2@infinite.com'`;
    // Abre a janela da corrida: cada remoção leva 200 ms depois de contar os Donos.
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION slow_delete() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.2); RETURN OLD; END $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS slow_delete ON backoffice_users;
      CREATE TRIGGER slow_delete BEFORE DELETE ON backoffice_users FOR EACH ROW EXECUTE FUNCTION slow_delete();
    `);
    const results = await Promise.allSettled([
      lib.removeAgencyPerson(admin, ids.agencyA, ids.ownerA),
      lib.removeAgencyPerson(admin, ids.agencyA, owner2),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM backoffice_users WHERE agency_id = ${ids.agencyA} AND role = 'agency_owner'`;
    assert.equal(n, 1);
    await sql.unsafe(`DROP TRIGGER slow_delete ON backoffice_users`);
  });

  it("tirar uma pessoa da agência tira o acesso e solta os clientes dela", async () => {
    const owner = await actor("dono@infinite.com");
    await assert.rejects(lib.removeAgencyPerson(owner, ids.agencyA, ids.ownerA), /a si mesmo/);
    await assert.rejects(lib.removeAgencyPerson(admin, ids.agencyA, ids.ownerA), /única pessoa Dona/);
    await assert.rejects(lib.removeAgencyPerson(owner, ids.agencyA, ids.ownerB), (e: Error & { status?: number }) => e.status === 404);
    await lib.removeAgencyPerson(owner, ids.agencyA, ids.memberA);
    assert.equal(await users.getBackofficeActorByEmail("membro@infinite.com"), null);
    const [left] = await sql`SELECT 1 FROM user_marketing_consultants WHERE user_id = ${ids.client1}`;
    assert.equal(left, undefined);
  });

  // ------------------------------------------------------------------ Plano da Agência (ADR 0046)

  const subscription = (over: { id?: string; status?: string; quantity?: number; agencyId?: string } = {}) => ({
    id: over.id ?? "sub_1",
    status: over.status ?? "active",
    customer: "cus_1",
    metadata: { agency_id: over.agencyId ?? ids.agencyA },
    items: { data: [{ id: "si_1", quantity: over.quantity ?? 4, price: { unit_amount: 24990, product: "prod_1" } }] },
  });
  const paidInvoice = (periodEnd: Date, subscriptionId = "sub_1") =>
    ({
      parent: { type: "subscription_details", subscription_details: { subscription: subscriptionId, metadata: { agency_id: ids.agencyA } } },
      lines: { data: [{ period: { end: Math.floor(periodEnd.getTime() / 1000) } }] },
    }) as unknown as Parameters<Plan["recordAgencyInvoicePaid"]>[0];
  const days = (n: number) => new Date(Date.now() + n * 86_400_000);

  it("plano cheio recusa ligar mais um cliente; sem plano, nenhum", async () => {
    await sql`UPDATE agencies SET plan_client_limit = 2 WHERE id = ${ids.agencyA}`;
    await assert.rejects(lib.addAgencyClient(admin, ids.agencyA, "casa@x.com"), /cobre 2 clientes/);
    await sql`UPDATE agencies SET plan_client_limit = 0 WHERE id = ${ids.agencyA}`;
    await assert.rejects(lib.addAgencyClient(admin, ids.agencyA, "casa@x.com"), /não tem plano/);
    const [linked] = await sql`SELECT 1 FROM agency_clients WHERE user_id = ${ids.houseClient}`;
    assert.equal(linked, undefined);
  });

  it("duas ligações ao mesmo tempo não passam juntas da última vaga", async () => {
    await sql`UPDATE agencies SET plan_client_limit = 3 WHERE id = ${ids.agencyA}`;
    await sql`INSERT INTO users (id, email) VALUES ('d0000000-0000-4000-8000-000000000005', 'c5@x.com')`;
    // Abre a janela da corrida: cada ligação leva 200 ms depois de contar os clientes.
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION slow_link() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.2); RETURN NEW; END $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS slow_link ON agency_clients;
      CREATE TRIGGER slow_link BEFORE INSERT ON agency_clients FOR EACH ROW EXECUTE FUNCTION slow_link();
    `);
    const results = await Promise.allSettled([lib.addAgencyClient(admin, ids.agencyA, "casa@x.com"), lib.addAgencyClient(admin, ids.agencyA, "c5@x.com")]);
    await sql.unsafe(`DROP TRIGGER slow_link ON agency_clients`);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM agency_clients WHERE agency_id = ${ids.agencyA}`;
    assert.equal(n, 3);
  });

  it("fatura paga: pago até avança, contas dos clientes ganham acesso (nunca encurta) e o limite vem do Stripe", async () => {
    const later = days(400);
    await sql`UPDATE users SET expiration_date = ${later} WHERE id = ${ids.client2}`;
    stripeState.subscriptions.sub_1 = subscription({ quantity: 4 });
    const periodEnd = days(30);
    assert.equal(await plan.recordAgencyInvoicePaid(paidInvoice(periodEnd)), true);

    const [row] = await sql`SELECT plan_paid_until, plan_status, plan_client_limit, stripe_subscription_id FROM agencies WHERE id = ${ids.agencyA}`;
    assert.equal(new Date(row.plan_paid_until).getTime(), Math.floor(periodEnd.getTime() / 1000) * 1000);
    assert.equal(row.plan_status, "active");
    assert.equal(row.plan_client_limit, 4);
    assert.equal(row.stripe_subscription_id, "sub_1");

    const expected = Math.floor(periodEnd.getTime() / 1000) * 1000 + 3 * 86_400_000;
    const accounts = await sql`SELECT id, expiration_date FROM users WHERE id IN (${ids.client1}, ${ids.client2}, ${ids.client3}, ${ids.houseClient})`;
    const exp = Object.fromEntries(accounts.map((a) => [a.id, a.expiration_date && new Date(a.expiration_date).getTime()]));
    assert.equal(exp[ids.client1], expected);
    assert.equal(exp[ids.client2], later.getTime(), "quem já tem acesso mais longo não perde dias");
    assert.equal(exp[ids.client3], null, "cliente de outra agência não é tocado");
    assert.equal(exp[ids.houseClient], null);
    const audits = await sql`SELECT target_user_id, admin_email FROM backoffice_audit_logs WHERE action = 'agency_plan_coverage'`;
    assert.deepEqual(audits.map((a) => a.target_user_id), [ids.client1]);

    // Reentrega de uma fatura velha não puxa o pago até para trás.
    await plan.recordAgencyInvoicePaid(paidInvoice(days(5)));
    const [again] = await sql`SELECT plan_paid_until FROM agencies WHERE id = ${ids.agencyA}`;
    assert.equal(new Date(again.plan_paid_until).getTime(), Math.floor(periodEnd.getTime() / 1000) * 1000);
  });

  it("fatura de assinatura de cliente (sem agency_id) passa reto", async () => {
    const invoice = paidInvoice(days(30));
    (invoice.parent as { subscription_details: { metadata: Record<string, string> } }).subscription_details.metadata = { app_user_id: ids.client1 };
    assert.equal(await plan.recordAgencyInvoicePaid(invoice), false);
    const [row] = await sql`SELECT plan_paid_until FROM agencies WHERE id = ${ids.agencyA}`;
    assert.equal(row.plan_paid_until, null);
  });

  it("conta ligada com o plano pago já entra coberta", async () => {
    stripeState.subscriptions.sub_1 = subscription();
    await plan.recordAgencyInvoicePaid(paidInvoice(days(30)));
    await lib.addAgencyClient(admin, ids.agencyA, "casa@x.com");
    const [account] = await sql`SELECT expiration_date FROM users WHERE id = ${ids.houseClient}`;
    assert.ok(account.expiration_date && new Date(account.expiration_date) > days(32));
  });

  it("evento atrasado de assinatura velha e cancelada não sobrescreve a atual", async () => {
    stripeState.subscriptions.sub_new = subscription({ id: "sub_new", quantity: 5 });
    stripeState.subscriptions.sub_old = subscription({ id: "sub_old", status: "canceled", quantity: 2 });
    await plan.syncAgencySubscription("sub_new");
    await plan.syncAgencySubscription("sub_old");
    const [row] = await sql`SELECT stripe_subscription_id, plan_status, plan_client_limit FROM agencies WHERE id = ${ids.agencyA}`;
    assert.deepEqual({ ...row }, { stripe_subscription_id: "sub_new", plan_status: "active", plan_client_limit: 5 });
  });

  it("só o admin define o plano, e não abaixo dos clientes já ligados", async () => {
    const owner = await actor("dono@infinite.com");
    await assert.rejects(plan.setAgencyPlan(owner, ids.agencyA, { unitAmount: "249,90", clientLimit: 4 }), (e: Error & { status?: number }) => e.status === 403);
    await assert.rejects(plan.setAgencyPlan(admin, ids.agencyA, { unitAmount: "249,90", clientLimit: 1 }), /já tem 2 clientes/);
    await plan.setAgencyPlan(admin, ids.agencyA, { unitAmount: "249,90", clientLimit: 4 });
    const [row] = await sql`SELECT plan_unit_amount_cents, plan_client_limit, plan_status FROM agencies WHERE id = ${ids.agencyA}`;
    assert.deepEqual({ ...row }, { plan_unit_amount_cents: 24990, plan_client_limit: 4, plan_status: "pending" });
  });
});
