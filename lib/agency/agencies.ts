import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { hasBackofficePermission, type BackofficeActor } from "@/lib/auth/rbac-core";
import { cancelClickupPostsOfClient } from "@/lib/clickup/service";
import { db } from "@/lib/db";
import {
  agency,
  agencyClient,
  backofficeAuditLog,
  backofficeUser,
  company,
  user,
  userCompany,
  userMarketingConsultant,
} from "@/lib/db/schema";

/**
 * Agências no backoffice (ADR 0044/0045): o admin cria a agência e o Dono; o Dono adiciona os
 * Clientes da Agência (contas Automatize, pelo e-mail) e convida Membros. A atribuição de clientes a
 * Membros é feita na área de Tráfego, como a carteira dos consultores.
 */

export class AgencyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export type AgencyPersonRole = "agency_owner" | "agency_member";

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** O admin gere qualquer agência; o Dono, só a dele. */
export function canManageAgency(actor: BackofficeActor, agencyId: string): boolean {
  if (hasBackofficePermission(actor, "team:manage")) return true;
  return hasBackofficePermission(actor, "agency:manage") && actor.agencyId === agencyId;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertManage(actor: BackofficeActor, agencyId: string, ...ids: string[]) {
  if (![agencyId, ...ids].every((id) => UUID.test(id))) throw new AgencyError("Não encontrado.", 404);
  if (!canManageAgency(actor, agencyId)) throw new AgencyError("Sem acesso a esta agência.", 403);
}

/** Agências que o ator gere: todas para o admin, a própria para o Dono. */
export async function listManagedAgencies(actor: BackofficeActor) {
  const managesAll = hasBackofficePermission(actor, "team:manage");
  if (!managesAll && !actor.agencyId) return [];
  return db
    .select({
      id: agency.id,
      name: agency.name,
      createdAt: agency.createdAt,
      clients: sql<number>`(select count(*)::int from ${agencyClient} where ${agencyClient.agencyId} = ${agency.id})`,
      people: sql<number>`(select count(*)::int from ${backofficeUser} where ${backofficeUser.agencyId} = ${agency.id})`,
    })
    .from(agency)
    .where(and(isNull(agency.archivedAt), managesAll ? undefined : eq(agency.id, actor.agencyId!)))
    .orderBy(asc(agency.name));
}

export async function getAgencyDetail(actor: BackofficeActor, agencyId: string) {
  assertManage(actor, agencyId);
  const [row] = await db.select().from(agency).where(and(eq(agency.id, agencyId), isNull(agency.archivedAt))).limit(1);
  if (!row) throw new AgencyError("Agência não encontrada.", 404);
  const [clients, people] = await Promise.all([
    db
      .select({
        userId: agencyClient.userId,
        email: user.email,
        name: user.name,
        addedAt: agencyClient.createdAt,
        companyName: sql<string | null>`(select ${company.name} from ${userCompany} join ${company} on ${company.id} = ${userCompany.companyId} where ${userCompany.userId} = ${user.id} order by ${userCompany.createdAt} asc limit 1)`,
        memberId: userMarketingConsultant.consultantId,
      })
      .from(agencyClient)
      .innerJoin(user, eq(user.id, agencyClient.userId))
      .leftJoin(userMarketingConsultant, eq(userMarketingConsultant.userId, agencyClient.userId))
      .where(eq(agencyClient.agencyId, agencyId))
      .orderBy(asc(user.email)),
    db
      .select({
        id: backofficeUser.id,
        email: backofficeUser.email,
        name: backofficeUser.name,
        role: backofficeUser.role,
        active: backofficeUser.active,
      })
      .from(backofficeUser)
      .where(eq(backofficeUser.agencyId, agencyId))
      .orderBy(asc(backofficeUser.email)),
  ]);
  return { agency: { id: row.id, name: row.name }, clients, people };
}

async function insertPerson(
  tx: Pick<typeof db, "insert" | "select">,
  agencyId: string,
  input: { email: string; name?: string | null; role: AgencyPersonRole },
) {
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) throw new AgencyError("E-mail inválido.");
  // Mensagem única: não conta ao Dono quais e-mails são da equipe Automatize ou de outra agência.
  const [created] = await tx
    .insert(backofficeUser)
    .values({ email, name: input.name?.trim() || null, role: input.role, agencyId, active: true })
    .onConflictDoNothing({ target: backofficeUser.email })
    .returning({ id: backofficeUser.id, email: backofficeUser.email, name: backofficeUser.name, role: backofficeUser.role });
  if (!created) throw new AgencyError("Não foi possível dar acesso a este e-mail. Fale com a Automatize.", 409);
  return created;
}

/** Só o admin cria agência, já com o Dono (sem Dono ninguém da agência gere nada). */
export async function createAgency(actor: BackofficeActor, input: { name: string; ownerEmail: string; ownerName?: string | null }) {
  if (!hasBackofficePermission(actor, "team:manage")) throw new AgencyError("Só admin cria agência.", 403);
  const name = input.name.trim();
  if (!name) throw new AgencyError("Dê um nome à agência.");
  const created = await db.transaction(async (tx) => {
    const [row] = await tx.insert(agency).values({ name }).returning({ id: agency.id, name: agency.name });
    const owner = await insertPerson(tx, row.id, { email: input.ownerEmail, name: input.ownerName, role: "agency_owner" });
    return { ...row, owner };
  });
  revalidateTag("consultants-for-filter", "max");
  return created;
}

export async function addAgencyPerson(
  actor: BackofficeActor,
  agencyId: string,
  input: { email: string; name?: string | null; role: AgencyPersonRole },
) {
  assertManage(actor, agencyId);
  const person = await insertPerson(db, agencyId, input);
  revalidateTag("consultants-for-filter", "max");
  return person;
}

/** Tira a pessoa da agência (perde o acesso); os clientes atribuídos a ela ficam sem responsável. */
export async function removeAgencyPerson(actor: BackofficeActor, agencyId: string, personId: string) {
  assertManage(actor, agencyId, personId);
  if (personId === actor.id) throw new AgencyError("Você não pode remover a si mesmo.", 409);
  await db.transaction(async (tx) => {
    // Trava a agência: duas remoções simultâneas não podem deixar a agência sem Dono.
    await tx.execute(sql`select 1 from ${agency} where ${agency.id} = ${agencyId} for update`);
    const [person] = await tx
      .select({ id: backofficeUser.id })
      .from(backofficeUser)
      .where(and(eq(backofficeUser.id, personId), eq(backofficeUser.agencyId, agencyId)))
      .limit(1);
    if (!person) throw new AgencyError("Pessoa não encontrada nesta agência.", 404);
    // A agência nunca fica sem Dono: sem ele, ninguém da agência gere clientes e pessoas.
    const owners = await tx
      .select({ id: backofficeUser.id })
      .from(backofficeUser)
      .where(and(eq(backofficeUser.agencyId, agencyId), eq(backofficeUser.role, "agency_owner"), eq(backofficeUser.active, true)));
    if (owners.length === 1 && owners[0]!.id === personId) throw new AgencyError("Esta é a única pessoa Dona da agência. Adicione outra pessoa como Dona antes de remover.", 409);
    await tx.delete(userMarketingConsultant).where(eq(userMarketingConsultant.consultantId, personId));
    await tx.delete(backofficeUser).where(eq(backofficeUser.id, personId));
  });
  revalidateTag("consultants-for-filter", "max");
}

/**
 * Liga uma conta Automatize à agência pelo e-mail. Só o admin: ligar dá à agência acesso à Meta e
 * ao Instagram da conta, então o Dono não pode puxar uma conta só por saber o e-mail (até existir o
 * Link de Conexão, em que o dono da conta autoriza). Uma conta só pode estar numa agência; a
 * atribuição a um consultor da Automatize, se houver, sai (cliente de agência é atendido por ela).
 */
export async function addAgencyClient(actor: BackofficeActor, agencyId: string, email: string) {
  assertManage(actor, agencyId);
  if (!hasBackofficePermission(actor, "team:manage")) {
    throw new AgencyError("Só a Automatize liga contas à agência. Peça ao seu contato na Automatize.", 403);
  }
  const normalized = normalizeEmail(email);
  return db.transaction(async (tx) => {
    const [account] = await tx.select({ id: user.id, email: user.email }).from(user).where(eq(user.email, normalized)).limit(1);
    if (!account) throw new AgencyError("Nenhuma conta Automatize com este e-mail. Peça ao cliente para criar a conta primeiro.", 404);
    const [current] = await tx.select({ agencyId: agencyClient.agencyId }).from(agencyClient).where(eq(agencyClient.userId, account.id)).limit(1);
    if (current) {
      throw new AgencyError(current.agencyId === agencyId ? "Esta conta já é cliente da agência." : "Esta conta já é cliente de outra agência.", 409);
    }
    const inserted = await tx
      .insert(agencyClient)
      .values({ userId: account.id, agencyId, addedByEmail: actor.email })
      .onConflictDoNothing()
      .returning({ userId: agencyClient.userId });
    if (!inserted.length) throw new AgencyError("Esta conta acabou de ser ligada a uma agência. Atualize a página.", 409);
    await tx.delete(userMarketingConsultant).where(eq(userMarketingConsultant.userId, account.id));
    await tx.insert(backofficeAuditLog).values({
      adminEmail: actor.email,
      targetUserId: account.id,
      action: "agency_client_added",
      fieldName: "agency_id",
      oldValue: null,
      newValue: agencyId,
    });
    return account;
  });
}

/** Desliga a conta da agência; a atribuição a um Membro sai junto. Nenhum dado da conta é apagado. */
export async function removeAgencyClient(actor: BackofficeActor, agencyId: string, userId: string) {
  assertManage(actor, agencyId, userId);
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(agencyClient)
      .where(and(eq(agencyClient.userId, userId), eq(agencyClient.agencyId, agencyId)))
      .returning({ userId: agencyClient.userId });
    if (!removed.length) throw new AgencyError("Esta conta não é cliente da agência.", 404);
    await tx.delete(userMarketingConsultant).where(eq(userMarketingConsultant.userId, userId));
    await tx.insert(backofficeAuditLog).values({
      adminEmail: actor.email,
      targetUserId: userId,
      action: "agency_client_removed",
      fieldName: "agency_id",
      oldValue: agencyId,
      newValue: "",
    });
  });
  // Agendamentos vindos do ClickUp deste cliente saem junto (ticket 04: arquivar cancela pendentes).
  await cancelClickupPostsOfClient(agencyId, userId);
}
