import { NextResponse } from "next/server";
import {
  createBackofficeUser,
  getBackofficeUserByEmail,
  listBackofficeUsers,
} from "@/lib/db/backoffice-rbac-queries";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { BACKOFFICE_ROLE_VALUES, type BackofficeRole } from "@/lib/auth/rbac-core";

function isBackofficeRole(value: unknown): value is BackofficeRole {
  return (
    typeof value === "string" &&
    (BACKOFFICE_ROLE_VALUES as readonly string[]).includes(value)
  );
}

function getPostgresErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

export async function GET() {
  const authz = await requireBackofficePermissionResponse("team:manage");
  if (!authz.ok) return authz.response;

  const users = await listBackofficeUsers();
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("team:manage");
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json()) as {
      email?: unknown;
      name?: unknown;
      role?: unknown;
    };

    if (typeof body.email !== "string" || !body.email.includes("@")) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    if (!isBackofficeRole(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const existingUser = await getBackofficeUserByEmail(body.email);
    if (existingUser) {
      return NextResponse.json(
        { error: "Já existe um usuário interno com este e-mail" },
        { status: 409 },
      );
    }

    const user = await createBackofficeUser({
      email: body.email,
      name: typeof body.name === "string" ? body.name : null,
      role: body.role,
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (getPostgresErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "Já existe um usuário interno com este e-mail" },
        { status: 409 },
      );
    }
    console.error("Error creating backoffice user:", error);
    return NextResponse.json(
      { error: "Failed to create backoffice user" },
      { status: 500 },
    );
  }
}
