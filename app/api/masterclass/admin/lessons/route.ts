import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
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
  supportMaterialTitle?: string;
  supportMaterialUrl?: string;
};

export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("masterclass:manage");
  if (!authz.ok) return authz.response;

  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("courseId");
  if (!courseId) {
    return NextResponse.json({ error: "courseId_required" }, { status: 422 });
  }

  const lessons = await listMasterclassLessons(courseId);
  return NextResponse.json(lessons);
}

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("masterclass:manage");
  if (!authz.ok) return authz.response;

  const body = (await request.json()) as CreateLessonBody;
  const position = body.position;
  if (
    !body.courseId ||
    !body.title?.trim() ||
    !body.videoProvider ||
    !body.videoAssetId?.trim() ||
    typeof position !== "number" ||
    !Number.isFinite(position) ||
    position <= 0
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
      supportMaterialTitle: body.supportMaterialTitle,
      supportMaterialUrl: body.supportMaterialUrl,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "failed_to_create_lesson" },
      { status: 422 },
    );
  }
}
