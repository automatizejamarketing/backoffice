import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { isAdminSession } from "@/lib/auth/admin";
import {
  createMasterclassCourse,
  listMasterclassCourses,
} from "@/lib/db/masterclass-queries";

type CreateCourseBody = {
  title?: string;
  description?: string;
  slug?: string;
  published?: boolean;
};

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isAdminSession(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const courses = await listMasterclassCourses();
  return NextResponse.json(courses);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isAdminSession(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as CreateCourseBody;
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 422 });
  }

  const created = await createMasterclassCourse({
    title: body.title,
    description: body.description,
    slug: body.slug,
    published: body.published ?? true,
  });

  return NextResponse.json(created, { status: 201 });
}
