import { isAgencyRole, isMarketingConsultantRole, isSalesRole } from "@/lib/auth/rbac-core";
import { and, eq, isNull, notInArray } from "drizzle-orm";
import { isAdminEmail } from "@/lib/config";
import { canAccessFinance } from "@/lib/auth/finance-access";
import { db } from "@/lib/db";
import {
  agency,
  agencyClient,
  ambassadorMember,
  backofficeUser,
  userMarketingConsultant,
} from "@/lib/db/schema";
import type { BackofficeActor, BackofficeRole } from "@/lib/auth/rbac-core";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const RECOVERABLE_DATABASE_ERROR_CODES = new Set([
  "42P01", // undefined_table
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
]);

function collectErrorCodes(error: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = error;

  for (let i = 0; i < 6 && current; i++) {
    if (typeof current !== "object" || current === null) break;
    if (
      "code" in current &&
      typeof (current as { code: unknown }).code === "string"
    ) {
      codes.push((current as { code: string }).code);
    }
    current = "cause" in current ? (current as { cause: unknown }).cause : null;
  }

  return codes;
}

function isRecoverableDatabaseLookupError(error: unknown): boolean {
  return collectErrorCodes(error).some((code) =>
    RECOVERABLE_DATABASE_ERROR_CODES.has(code),
  );
}

const agencyClientIds = () => db.select({ userId: agencyClient.userId }).from(agencyClient);

/** Carteira atribuída a um consultor da Automatize, sem clientes de agências externas. */
async function getAssignedUserIds(consultantId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: userMarketingConsultant.userId })
    .from(userMarketingConsultant)
    .where(
      and(
        eq(userMarketingConsultant.consultantId, consultantId),
        notInArray(userMarketingConsultant.userId, agencyClientIds()),
      ),
    );
  return rows.map((row) => row.userId);
}

/**
 * Clientes que uma pessoa de agência opera: o Dono, todos os da agência; o Membro, os atribuídos a
 * ele que ainda são da agência (a atribuição não sobrevive à saída do cliente).
 */
async function getAgencyScopeUserIds(
  actorId: string,
  role: "agency_owner" | "agency_member",
  agencyId: string,
): Promise<string[]> {
  const inAgency = eq(agencyClient.agencyId, agencyId);
  const rows =
    role === "agency_owner"
      ? await db.select({ userId: agencyClient.userId }).from(agencyClient).where(inAgency)
      : await db
          .select({ userId: userMarketingConsultant.userId })
          .from(userMarketingConsultant)
          .innerJoin(agencyClient, eq(agencyClient.userId, userMarketingConsultant.userId))
          .where(and(eq(userMarketingConsultant.consultantId, actorId), inAgency));
  return rows.map((row) => row.userId);
}

async function getAllAgencyClientIds(): Promise<string[]> {
  const rows = await agencyClientIds();
  return rows.map((row) => row.userId);
}

/** A agência existe e está ativa; pessoa de agência arquivada ou sem agência não entra. */
async function isActiveAgency(agencyId: string | null): Promise<boolean> {
  if (!agencyId) return false;
  const [row] = await db
    .select({ id: agency.id })
    .from(agency)
    .where(and(eq(agency.id, agencyId), isNull(agency.archivedAt)))
    .limit(1);
  return Boolean(row);
}

export async function getBackofficeActorByEmail(
  email: string | null | undefined,
): Promise<BackofficeActor | null> {
  if (!email) return null;

  const normalizedEmail = normalizeEmail(email);
  const isFallbackAdmin = isAdminEmail(normalizedEmail);

  try {
    const [dbUser] = await db
      .select()
      .from(backofficeUser)
      .where(eq(backofficeUser.email, normalizedEmail))
      .limit(1);

    if (isFallbackAdmin) {
      return {
        id: dbUser?.id ?? `admin:${normalizedEmail}`,
        email: normalizedEmail,
        name: dbUser?.name ?? null,
        role: "admin",
        source: dbUser ? "database" : "admin_email_fallback",
      };
    }

    if (!dbUser) {
      return canAccessFinance(normalizedEmail)
        ? {
            id: `finance:${normalizedEmail}`,
            email: normalizedEmail,
            role: "finance_viewer",
            source: "finance_email_fallback",
          }
        : null;
    }
    if (!dbUser.active) return null;

    const role = dbUser.role as BackofficeRole;
    if (role === "finance_viewer" && !canAccessFinance(normalizedEmail)) {
      return null;
    }
    if (isAgencyRole(role)) {
      if (!(await isActiveAgency(dbUser.agencyId))) return null;
      return {
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        role,
        source: "database",
        agencyId: dbUser.agencyId,
        assignedUserIds: await getAgencyScopeUserIds(
          dbUser.id,
          role as "agency_owner" | "agency_member",
          dbUser.agencyId!,
        ),
      };
    }
    const [membership] = await db
      .select()
      .from(ambassadorMember)
      .where(eq(ambassadorMember.userId, dbUser.id));
    return {
      ambassadorAccess: Boolean(membership),
      ambassadorGrant: membership?.canGrantStarter ?? false,
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role,
      salesRole: isSalesRole(dbUser.salesRole) ? dbUser.salesRole : null,
      source: "database",
      assignedUserIds: isMarketingConsultantRole(role)
        ? await getAssignedUserIds(dbUser.id)
        : undefined,
      // Só o admin vê clientes de agências externas (suporte); o resto da equipe não.
      hiddenUserIds: role === "admin" ? undefined : await getAllAgencyClientIds(),
    };
  } catch (error) {
    if (isFallbackAdmin && isRecoverableDatabaseLookupError(error)) {
      return {
        id: `admin:${normalizedEmail}`,
        email: normalizedEmail,
        role: "admin",
        source: "admin_email_fallback",
      };
    }
    if (
      canAccessFinance(normalizedEmail) &&
      isRecoverableDatabaseLookupError(error)
    ) {
      return {
        id: `finance:${normalizedEmail}`,
        email: normalizedEmail,
        role: "finance_viewer",
        source: "finance_email_fallback",
      };
    }
    throw error;
  }
}

export async function canBackofficeEmailSignIn(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  if (isAdminEmail(email)) return true;

  try {
    const actor = await getBackofficeActorByEmail(email);
    return Boolean(actor);
  } catch (error) {
    if (isRecoverableDatabaseLookupError(error)) return false;
    throw error;
  }
}
