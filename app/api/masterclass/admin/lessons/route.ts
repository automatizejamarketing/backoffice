import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { isAdminSession } from "@/lib/auth/admin";
import {
  createMasterclassLesson,
  listMasterclassLessons,
  type VideoProvider,
} from "@/lib/db/masterclass-queries";

type CreateLessonBody = {
  courseId?: string;
  title?: string;
  slug?: string;
  videoProvider?: VideoProvider;
  videoAssetId?: string;
  position?: number;
  published?: boolean;
};

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isAdminSession(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("courseId");
  if (!courseId) {
    return NextResponse.json({ error: "courseId_required" }, { status: 422 });
  }

  const lessons = await listMasterclassLessons(courseId);
  return NextResponse.json(lessons);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isAdminSession(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as CreateLessonBody;
  const position = body.position;
  if (
    !body.courseId ||
    !body.title?.trim() ||
    !body.videoProvider ||
    !body.videoAssetId?.trim() ||
    !Number.isFinite(position) ||
    (position ?? 0) <= 0
  ) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
  }

  try {
    const created = await createMasterclassLesson({
      courseId: body.courseId,
      title: body.title,
      slug: body.slug,
      videoProvider: body.videoProvider,
      videoAssetId: body.videoAssetId,
      position,
      published: body.published ?? true,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "failed_to_create_lesson" },
      { status: 422 },
    );
  }
}
