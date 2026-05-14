import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  deleteMasterclassLesson,
  type VideoProvider,
  updateMasterclassLesson,
} from "@/lib/db/masterclass-queries";

type UpdateLessonBody = {
  title?: unknown;
  slug?: unknown;
  videoProvider?: unknown;
  videoAssetId?: unknown;
  position?: unknown;
  published?: unknown;
};

function isVideoProvider(value: unknown): value is VideoProvider {
  return value === "youtube" || value === "mux" || value === "cloudflare";
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("masterclass:manage");
  if (!authz.ok) return authz.response;

  const { id } = await params;
  const body = (await request.json()) as UpdateLessonBody;

  const data: Parameters<typeof updateMasterclassLesson>[1] = {};

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
    }
    data.title = body.title;
  }

  if (body.slug !== undefined) {
    if (typeof body.slug !== "string") {
      return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
    }
    data.slug = body.slug;
  }

  if (body.videoProvider !== undefined) {
    if (!isVideoProvider(body.videoProvider)) {
      return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
    }
    data.videoProvider = body.videoProvider;
  }

  if (body.videoAssetId !== undefined) {
    if (typeof body.videoAssetId !== "string" || !body.videoAssetId.trim()) {
      return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
    }
    data.videoAssetId = body.videoAssetId;
  }

  if (body.position !== undefined) {
    if (
      typeof body.position !== "number" ||
      !Number.isFinite(body.position) ||
      body.position <= 0
    ) {
      return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
    }
    data.position = body.position;
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
    const updated = await updateMasterclassLesson(id, data);
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
      { error: (error as Error).message || "failed_to_update_lesson" },
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
  const deleted = await deleteMasterclassLesson(id);
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(deleted);
}
