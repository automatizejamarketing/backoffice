import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "./index";
import { masterclassCourse, masterclassLesson } from "./schema";

export type VideoProvider = "youtube" | "mux" | "cloudflare";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

export function normalizeVideoAssetId(
  provider: VideoProvider,
  rawValue: string,
): string | null {
  const input = rawValue.trim();
  if (!input) return null;

  if (provider !== "youtube") {
    return input;
  }

  if (/^[a-zA-Z0-9_-]{8,20}$/.test(input)) {
    return input;
  }

  try {
    const url = new URL(input);
    if (url.hostname.includes("youtube.com")) {
      const id = url.searchParams.get("v");
      return id && /^[a-zA-Z0-9_-]{8,20}$/.test(id) ? id : null;
    }
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.replace("/", "");
      return /^[a-zA-Z0-9_-]{8,20}$/.test(id) ? id : null;
    }
  } catch {
    return null;
  }

  return null;
}

export async function listMasterclassCourses() {
  return db.select().from(masterclassCourse).orderBy(desc(masterclassCourse.createdAt));
}

export async function createMasterclassCourse(input: {
  title: string;
  description?: string;
  slug?: string;
  published?: boolean;
}) {
  const id = crypto.randomUUID();
  const slug = slugify(input.slug?.trim() || input.title);

  const [created] = await db
    .insert(masterclassCourse)
    .values({
      id,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      slug,
      published: input.published ?? true,
    })
    .returning();

  return created;
}

export async function listMasterclassLessons(courseId: string) {
  return db
    .select()
    .from(masterclassLesson)
    .where(eq(masterclassLesson.courseId, courseId))
    .orderBy(asc(masterclassLesson.position));
}

export async function createMasterclassLesson(input: {
  courseId: string;
  title: string;
  slug?: string;
  videoProvider: VideoProvider;
  videoAssetId: string;
  position: number;
  published?: boolean;
}) {
  const normalizedAssetId = normalizeVideoAssetId(input.videoProvider, input.videoAssetId);
  if (!normalizedAssetId) {
    throw new Error("video_asset_id inválido para o provedor informado.");
  }

  const id = crypto.randomUUID();
  const slug = slugify(input.slug?.trim() || input.title);

  const [created] = await db
    .insert(masterclassLesson)
    .values({
      id,
      courseId: input.courseId,
      title: input.title.trim(),
      slug,
      videoProvider: input.videoProvider,
      videoAssetId: normalizedAssetId,
      position: input.position,
      published: input.published ?? true,
    })
    .returning();

  return created;
}

export async function reorderMasterclassLessons(courseId: string, lessonIdsInOrder: string[]) {
  for (const [index, lessonId] of lessonIdsInOrder.entries()) {
    await db
      .update(masterclassLesson)
      .set({
        position: index + 1,
        updatedAt: new Date(),
      })
      .where(
        and(eq(masterclassLesson.id, lessonId), eq(masterclassLesson.courseId, courseId)),
      );
  }
}
