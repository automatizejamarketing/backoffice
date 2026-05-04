import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { isAdminSession } from "@/lib/auth/admin";
import { reorderMasterclassLessons } from "@/lib/db/masterclass-queries";

type ReorderBody = {
  courseId?: string;
  lessonIdsInOrder?: string[];
};

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isAdminSession(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as ReorderBody;
  if (!body.courseId || !Array.isArray(body.lessonIdsInOrder)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
  }

  await reorderMasterclassLessons(body.courseId, body.lessonIdsInOrder);
  return NextResponse.json({ ok: true });
}
