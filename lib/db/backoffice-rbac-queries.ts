import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import {
  agencyClient,
  backofficeUser,
  company,
  metaBusinessAccount,
  user,
  userCompany,
  userMarketingConsultant,
} from "@/lib/db/schema";
import {
  type BackofficeActor,
  type BackofficeRole,
  consultantSeesOnlyAssignedClients,
  isAgencyRole,
  isMarketingConsultantRole,
  type SalesRole,
} from "@/lib/auth/rbac-core";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Equipe Automatize (sem agência). Pessoas de agência são geridas na tela Agências. */
export async function listBackofficeUsers() {
  return db
    .select()
    .from(backofficeUser)
    .where(isNull(backofficeUser.agencyId))
    .orderBy(asc(backofficeUser.email));
}

export async function getBackofficeUserById(id: string) {
  const [found] = await db
    .select()
    .from(backofficeUser)
    .where(eq(backofficeUser.id, id))
    .limit(1);
  return found ?? null;
}

export async function getBackofficeUserByEmail(email: string) {
  const [found] = await db
    .select()
    .from(backofficeUser)
    .where(eq(backofficeUser.email, normalizeEmail(email)))
    .limit(1);
  return found ?? null;
}

export async function createBackofficeUser(data: {
  email: string;
  name?: string | null;
  role: BackofficeRole;
  salesRole?: SalesRole | null;
}) {
  const [created] = await db
    .insert(backofficeUser)
    .values({
      email: normalizeEmail(data.email),
      name: data.name?.trim() || null,
      role: data.role,
      salesRole: data.salesRole ?? null,
      active: true,
    })
    .returning();
  return created;
}

export async function updateBackofficeUser(
  id: string,
  data: Partial<{
    email: string;
    name: string | null;
    role: BackofficeRole;
    salesRole: SalesRole | null;
    active: boolean;
  }>,
) {
  const [updated] = await db
    .update(backofficeUser)
    .set({
      ...data,
      email: data.email === undefined ? undefined : normalizeEmail(data.email),
      name: data.name === undefined ? undefined : data.name?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(backofficeUser.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteBackofficeUser(id: string) {
  await db
    .delete(userMarketingConsultant)
    .where(eq(userMarketingConsultant.consultantId, id));

  const [deleted] = await db
    .delete(backofficeUser)
    .where(eq(backofficeUser.id, id))
    .returning();

  return deleted ?? null;
}

/**
 * Quem pode receber clientes: consultores da Automatize (`agencyId` nulo) ou, numa agência, o Dono
 * e os Membros dela.
 */
export async function listActiveMarketingConsultants(agencyId: string | null = null) {
  return db
    .select({
      id: backofficeUser.id,
      email: backofficeUser.email,
      name: backofficeUser.name,
    })
    .from(backofficeUser)
    .where(
      and(
        agencyId
          ? and(
              inArray(backofficeUser.role, ["agency_owner", "agency_member"]),
              eq(backofficeUser.agencyId, agencyId),
            )
          : and(
              inArray(backofficeUser.role, [
                "marketing_consultant",
                "marketing_consultant_premium",
              ]),
              isNull(backofficeUser.agencyId),
            ),
        eq(backofficeUser.active, true),
      ),
    )
    .orderBy(asc(backofficeUser.email));
}

/**
 * Options for admin consultant filters: active marketing consultants plus
 * anyone who already has clients assigned (e.g. admins with a carteira).
 */
async function loadConsultantsForFilter(agencyId: string | null) {
  const [roleConsultants, assignedConsultants] = await Promise.all([
    listActiveMarketingConsultants(agencyId),
    db
      .selectDistinct({
        id: backofficeUser.id,
        email: backofficeUser.email,
        name: backofficeUser.name,
      })
      .from(userMarketingConsultant)
      .innerJoin(
        backofficeUser,
        eq(userMarketingConsultant.consultantId, backofficeUser.id),
      )
      .where(
        agencyId
          ? eq(backofficeUser.agencyId, agencyId)
          : isNull(backofficeUser.agencyId),
      )
      .orderBy(asc(backofficeUser.email)),
  ]);

  const byId = new Map<string, { id: string; email: string; name: string | null }>();
  for (const consultant of [...roleConsultants, ...assignedConsultants]) {
    byId.set(consultant.id, consultant);
  }

  return [...byId.values()].sort((a, b) => a.email.localeCompare(b.email));
}

/** Opções do filtro "Carteira de": a equipe Automatize ou, para uma agência, só a gente dela. */
export async function listConsultantsForFilter(agencyId: string | null = null) {
  return unstable_cache(
    () => loadConsultantsForFilter(agencyId),
    ["consultants-for-filter", agencyId ?? "automatize"],
    { revalidate: 60, tags: ["consultants-for-filter"] },
  )();
}

export async function getAssignedMarketingConsultant(userId: string) {
  const [assignment] = await db
    .select({
      userId: userMarketingConsultant.userId,
      consultantId: backofficeUser.id,
      consultantEmail: backofficeUser.email,
      consultantName: backofficeUser.name,
      assignedByEmail: userMarketingConsultant.assignedByEmail,
      updatedAt: userMarketingConsultant.updatedAt,
    })
    .from(userMarketingConsultant)
    .innerJoin(
      backofficeUser,
      eq(userMarketingConsultant.consultantId, backofficeUser.id),
    )
    .where(eq(userMarketingConsultant.userId, userId))
    .limit(1);
  return assignment ?? null;
}

export async function setMarketingConsultantAssignment(data: {
  userId: string;
  consultantId: string | null;
  assignedByEmail: string;
}) {
  if (!data.consultantId) {
    await db
      .delete(userMarketingConsultant)
      .where(eq(userMarketingConsultant.userId, data.userId));
    return null;
  }

  const [consultant] = await db
    .select()
    .from(backofficeUser)
    .where(eq(backofficeUser.id, data.consultantId))
    .limit(1);

  const [agencyLink] = await db
    .select({ agencyId: agencyClient.agencyId })
    .from(agencyClient)
    .where(eq(agencyClient.userId, data.userId))
    .limit(1);

  // Cliente de agência só vai para gente da mesma agência; cliente da Automatize, só para consultor
  // interno (ADR 0045).
  const fits = agencyLink
    ? isAgencyRole(consultant?.role ?? "admin") &&
      consultant?.agencyId === agencyLink.agencyId
    : isMarketingConsultantRole(consultant?.role ?? "admin") &&
      !consultant?.agencyId;
  if (!consultant || !fits || !consultant.active) {
    throw new Error("invalid_consultant");
  }

  const [assignment] = await db
    .insert(userMarketingConsultant)
    .values({
      userId: data.userId,
      consultantId: data.consultantId,
      assignedByEmail: normalizeEmail(data.assignedByEmail),
    })
    .onConflictDoUpdate({
      target: userMarketingConsultant.userId,
      set: {
        consultantId: data.consultantId,
        assignedByEmail: normalizeEmail(data.assignedByEmail),
        updatedAt: new Date(),
      },
    })
    .returning();

  return assignment;
}

export type MarketingConsultantPortfolioItem = {
  userId: string;
  userEmail: string;
  userImageUrl: string | null;
  companyName: string | null;
  consultantEmail: string | null;
  metaAccountName: string | null;
  metaUpdatedAt: string | null;
};

export async function getMarketingConsultantPortfolio(
  actor: BackofficeActor,
): Promise<MarketingConsultantPortfolioItem[]> {
  const rows = await db
    .select({
      userId: user.id,
      userEmail: user.email,
      userImageUrl: user.image_url,
      consultantEmail: backofficeUser.email,
    })
    .from(userMarketingConsultant)
    .innerJoin(user, eq(userMarketingConsultant.userId, user.id))
    .innerJoin(
      backofficeUser,
      eq(userMarketingConsultant.consultantId, backofficeUser.id),
    )
    .where(
      consultantSeesOnlyAssignedClients(actor.role)
        ? eq(userMarketingConsultant.consultantId, actor.id)
        : undefined,
    )
    .orderBy(asc(user.email));

  return Promise.all(
    rows.map(async (row) => {
      const [[companyInfo], [metaAccount]] = await Promise.all([
        db
          .select({ companyName: company.name })
          .from(userCompany)
          .leftJoin(company, eq(userCompany.companyId, company.id))
          .where(eq(userCompany.userId, row.userId))
          .limit(1),
        db
          .select({
            name: metaBusinessAccount.name,
            updatedAt: metaBusinessAccount.updatedAt,
          })
          .from(metaBusinessAccount)
          .where(eq(metaBusinessAccount.userId, row.userId))
          .orderBy(desc(metaBusinessAccount.updatedAt))
          .limit(1),
      ]);

      return {
        ...row,
        companyName: companyInfo?.companyName ?? null,
        metaAccountName: metaAccount?.name ?? null,
        metaUpdatedAt: metaAccount?.updatedAt?.toISOString() ?? null,
      };
    }),
  );
}
