import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  deleteMasterclassCourse,
  updateMasterclassCourse,
} from "@/lib/db/masterclass-queries";

type UpdateCourseBody = {
  title?: unknown;
  description?: unknown;
  slug?: unknown;
  published?: unknown;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("masterclass:manage");
  if (!authz.ok) return authz.response;

  const { id } = await params;
  const body = (await request.json()) as UpdateCourseBody;

  const data: Parameters<typeof updateMasterclassCourse>[1] = {};

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
    }
    data.title = body.title;
  }

  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") {
      return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
    }
    data.description = body.description;
  }

  if (body.slug !== undefined) {
    if (typeof body.slug !== "string") {
      return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
    }
    data.slug = body.slug;
  }

  if (body.published !== undefined) {
    if (typeof body.published !== "boolean") {
      return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
    }
    data.published = body.published;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
  }

  try {
    const updated = await updateMasterclassCourse(id, data);
    if (!updated) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "23505") {
      return NextResponse.json({ error: "conflict" }, { status: 409 });
    }
    return NextResponse.json(
      { error: (error as Error).message || "failed_to_update_course" },
      { status: 422 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("masterclass:manage");
  if (!authz.ok) return authz.response;

  const { id } = await params;
  const deleted = await deleteMasterclassCourse(id);
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(deleted);
}
