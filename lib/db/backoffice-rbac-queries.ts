import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  backofficeUser,
  company,
  metaBusinessAccount,
  user,
  userCompany,
  userMarketingConsultant,
} from "@/lib/db/schema";
import type { BackofficeActor, BackofficeRole } from "@/lib/auth/rbac-core";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function listBackofficeUsers() {
  return db
    .select()
    .from(backofficeUser)
    .orderBy(asc(backofficeUser.email));
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
}) {
  const [created] = await db
    .insert(backofficeUser)
    .values({
      email: normalizeEmail(data.email),
      name: data.name?.trim() || null,
      role: data.role,
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

export async function listActiveMarketingConsultants() {
  return db
    .select({
      id: backofficeUser.id,
      email: backofficeUser.email,
      name: backofficeUser.name,
    })
    .from(backofficeUser)
    .where(
      and(
        eq(backofficeUser.role, "marketing_consultant"),
        eq(backofficeUser.active, true),
      ),
    )
    .orderBy(asc(backofficeUser.email));
}

/**
 * Options for admin consultant filters: active marketing consultants plus
 * anyone who already has clients assigned (e.g. admins with a carteira).
 */
export async function listConsultantsForFilter() {
  const [roleConsultants, assignedConsultants] = await Promise.all([
    listActiveMarketingConsultants(),
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
      .orderBy(asc(backofficeUser.email)),
  ]);

  const byId = new Map<string, { id: string; email: string; name: string | null }>();
  for (const consultant of [...roleConsultants, ...assignedConsultants]) {
    byId.set(consultant.id, consultant);
  }

  return [...byId.values()].sort((a, b) => a.email.localeCompare(b.email));
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

  if (!consultant || consultant.role !== "marketing_consultant" || !consultant.active) {
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
      actor.role === "marketing_consultant"
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
