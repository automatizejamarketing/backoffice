import { eq } from "drizzle-orm";
import { isAdminEmail } from "@/lib/config";
import { canAccessFinance } from "@/lib/auth/finance-access";
import { db } from "@/lib/db";
import { backofficeUser, userMarketingConsultant } from "@/lib/db/schema";
import type {
  BackofficeActor,
  BackofficeRole,
} from "@/lib/auth/rbac-core";

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

async function getAssignedUserIds(consultantId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: userMarketingConsultant.userId })
    .from(userMarketingConsultant)
    .where(eq(userMarketingConsultant.consultantId, consultantId));
  return rows.map((row) => row.userId);
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
    return {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role,
      source: "database",
      assignedUserIds:
        role === "marketing_consultant"
          ? await getAssignedUserIds(dbUser.id)
          : undefined,
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
