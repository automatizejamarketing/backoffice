import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
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
  const authz = await requireBackofficePermissionResponse("masterclass:manage");
  if (!authz.ok) return authz.response;

  const courses = await listMasterclassCourses();
  return NextResponse.json(courses);
}

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("masterclass:manage");
  if (!authz.ok) return authz.response;

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
