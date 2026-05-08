import { NextResponse } from "next/server";
import {
  deleteBackofficeUser,
  getBackofficeUserByEmail,
  updateBackofficeUser,
} from "@/lib/db/backoffice-rbac-queries";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { BACKOFFICE_ROLE_VALUES, type BackofficeRole } from "@/lib/auth/rbac-core";

function isBackofficeRole(value: unknown): value is BackofficeRole {
  return (
    typeof value === "string" &&
    (BACKOFFICE_ROLE_VALUES as readonly string[]).includes(value)
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("team:manage");
  if (!authz.ok) return authz.response;

  const { id } = await params;
  const body = (await request.json()) as {
    email?: unknown;
    name?: unknown;
    role?: unknown;
    active?: unknown;
  };

  const data: Parameters<typeof updateBackofficeUser>[1] = {};

  if (body.email !== undefined) {
    if (typeof body.email !== "string" || !body.email.includes("@")) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const existingUser = await getBackofficeUserByEmail(body.email);
    if (existingUser && existingUser.id !== id) {
      return NextResponse.json(
        { error: "Já existe um usuário interno com este e-mail" },
        { status: 409 },
      );
    }
    data.email = body.email;
  }

  if (body.name !== undefined) {
    if (body.name !== null && typeof body.name !== "string") {
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }
    data.name = body.name;
  }
  if (body.role !== undefined) {
    if (!isBackofficeRole(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    data.role = body.role;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ error: "Invalid active" }, { status: 400 });
    }
    data.active = body.active;
  }

  const user = await updateBackofficeUser(id, data);
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ user });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("team:manage");
  if (!authz.ok) return authz.response;

  const { id } = await params;
  const user = await deleteBackofficeUser(id);

  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ user });
}
