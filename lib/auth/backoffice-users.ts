import { eq } from "drizzle-orm";
import { isAdminEmail } from "@/lib/config";
import { db } from "@/lib/db";
import { backofficeUser, userMarketingConsultant } from "@/lib/db/schema";
import type {
  BackofficeActor,
  BackofficeRole,
} from "@/lib/auth/rbac-core";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getPostgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < 4 && current; i++) {
    if (typeof current !== "object" || current === null) break;
    if (
      "code" in current &&
      typeof (current as { code: unknown }).code === "string"
    ) {
      return (current as { code: string }).code;
    }
    current = "cause" in current ? (current as { cause: unknown }).cause : null;
  }
  return undefined;
}

function isMissingBackofficeTable(error: unknown): boolean {
  return getPostgresErrorCode(error) === "42P01";
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

    if (!dbUser?.active) return null;

    const role = dbUser.role as BackofficeRole;
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
    if (isFallbackAdmin && isMissingBackofficeTable(error)) {
      return {
        id: `admin:${normalizedEmail}`,
        email: normalizedEmail,
        role: "admin",
        source: "admin_email_fallback",
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
    if (isMissingBackofficeTable(error)) return false;
    throw error;
  }
}
