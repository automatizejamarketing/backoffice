import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { reorderMasterclassLessons } from "@/lib/db/masterclass-queries";

type ReorderBody = {
  courseId?: string;
  lessonIdsInOrder?: string[];
};

export async function PATCH(request: Request) {
  const authz = await requireBackofficePermissionResponse("masterclass:manage");
  if (!authz.ok) return authz.response;

  const body = (await request.json()) as ReorderBody;
  if (!body.courseId || !Array.isArray(body.lessonIdsInOrder)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
  }

  await reorderMasterclassLessons(body.courseId, body.lessonIdsInOrder);
  return NextResponse.json({ ok: true });
}
