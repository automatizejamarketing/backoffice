import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getBackofficeActorByEmail } from "@/lib/auth/backoffice-users";
import {
  BACKOFFICE_MAGIC_SESSION_COOKIE,
  verifyBackofficeMagicSessionToken,
} from "@/lib/auth/magic-session";
import {
  canAccessMarketingUser,
  hasBackofficePermission,
  type BackofficeActor,
  type BackofficePermission,
} from "@/lib/auth/rbac-core";

export class BackofficeAuthorizationError extends Error {
  status: 400 | 401 | 403;

  constructor(status: 400 | 401 | 403, message: string) {
    super(message);
    this.name = "BackofficeAuthorizationError";
    this.status = status;
  }
}

export async function getCurrentBackofficeActor(): Promise<BackofficeActor | null> {
  const session = await auth();
  const sessionEmail = session?.user?.email;

  if (sessionEmail) {
    return getBackofficeActorByEmail(sessionEmail);
  }

  const cookieStore = await cookies();
  const magicSession = verifyBackofficeMagicSessionToken(
    cookieStore.get(BACKOFFICE_MAGIC_SESSION_COOKIE)?.value,
  );

  return getBackofficeActorByEmail(magicSession?.email);
}

export async function requireBackofficePermission(
  permission: BackofficePermission,
): Promise<BackofficeActor> {
  const actor = await getCurrentBackofficeActor();
  if (!actor) {
    throw new BackofficeAuthorizationError(401, "Unauthorized");
  }
  if (!hasBackofficePermission(actor, permission)) {
    throw new BackofficeAuthorizationError(403, "Forbidden");
  }
  return actor;
}

export async function requireMarketingUserAccess(
  userId: string | null | undefined,
  permission: Extract<BackofficePermission, "marketing:read" | "marketing:write"> =
    "marketing:read",
): Promise<BackofficeActor> {
  if (!userId) {
    throw new BackofficeAuthorizationError(400, "Missing userId");
  }

  const actor = await requireBackofficePermission(permission);
  if (!canAccessMarketingUser(actor, userId)) {
    throw new BackofficeAuthorizationError(403, "Forbidden");
  }
  return actor;
}

export async function requirePagePermission(
  permission: BackofficePermission,
  deniedRedirect = "/portfolio",
): Promise<BackofficeActor> {
  const actor = await getCurrentBackofficeActor();
  if (!actor) redirect("/login");
  if (!hasBackofficePermission(actor, permission)) redirect(deniedRedirect);
  return actor;
}

export function backofficeAuthErrorResponse(error: unknown): NextResponse<never> {
  if (error instanceof BackofficeAuthorizationError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    ) as NextResponse<never>;
  }
  throw error;
}

export async function requireBackofficePermissionResponse(
  permission: BackofficePermission,
): Promise<
  { ok: true; actor: BackofficeActor } | { ok: false; response: NextResponse<never> }
> {
  try {
    return { ok: true, actor: await requireBackofficePermission(permission) };
  } catch (error) {
    return { ok: false, response: backofficeAuthErrorResponse(error) };
  }
}

export async function requireMarketingUserAccessResponse(
  userId: string | null | undefined,
  permission: Extract<BackofficePermission, "marketing:read" | "marketing:write"> =
    "marketing:read",
): Promise<
  { ok: true; actor: BackofficeActor } | { ok: false; response: NextResponse<never> }
> {
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing userId" },
        { status: 400 },
      ) as NextResponse<never>,
    };
  }

  try {
    return {
      ok: true,
      actor: await requireMarketingUserAccess(userId, permission),
    };
  } catch (error) {
    return { ok: false, response: backofficeAuthErrorResponse(error) };
  }
}
