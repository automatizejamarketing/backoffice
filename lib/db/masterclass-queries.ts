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

export async function updateMasterclassCourse(
  id: string,
  input: {
    title?: string;
    description?: string | null;
    slug?: string;
    published?: boolean;
  },
) {
  const data: Partial<typeof masterclassCourse.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.title !== undefined) {
    data.title = input.title.trim();
  }

  if (input.description !== undefined) {
    data.description = input.description?.trim() || null;
  }

  if (input.slug !== undefined) {
    const base = input.slug.trim() || (input.title?.trim() ?? "");
    data.slug = slugify(base);
  }

  if (input.published !== undefined) {
    data.published = input.published;
  }

  const [updated] = await db
    .update(masterclassCourse)
    .set(data)
    .where(eq(masterclassCourse.id, id))
    .returning();

  return updated ?? null;
}

export async function deleteMasterclassCourse(id: string) {
  const [deleted] = await db
    .delete(masterclassCourse)
    .where(eq(masterclassCourse.id, id))
    .returning();

  return deleted ?? null;
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

export async function updateMasterclassLesson(
  id: string,
  input: {
    title?: string;
    slug?: string;
    videoProvider?: VideoProvider;
    videoAssetId?: string;
    position?: number;
    published?: boolean;
    supportMaterialTitle?: string | null;
    supportMaterialUrl?: string | null;
  },
) {
  const [existing] = await db
    .select()
    .from(masterclassLesson)
    .where(eq(masterclassLesson.id, id))
    .limit(1);

  if (!existing) return null;

  const nextProvider = input.videoProvider ?? (existing.videoProvider as VideoProvider);

  const data: Partial<typeof masterclassLesson.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.title !== undefined) {
    data.title = input.title.trim();
  }

  if (input.slug !== undefined) {
    const base = input.slug.trim() || (input.title?.trim() ?? existing.title);
    data.slug = slugify(base);
  }

  if (input.videoProvider !== undefined) {
    data.videoProvider = input.videoProvider;
  }

  if (input.videoAssetId !== undefined) {
    const normalized = normalizeVideoAssetId(nextProvider, input.videoAssetId);
    if (!normalized) {
      throw new Error("video_asset_id inválido para o provedor informado.");
    }
    data.videoAssetId = normalized;
  } else if (input.videoProvider !== undefined) {
    const normalized = normalizeVideoAssetId(nextProvider, existing.videoAssetId);
    if (!normalized) {
      throw new Error("video_asset_id inválido para o provedor informado.");
    }
    data.videoAssetId = normalized;
  }

  if (input.position !== undefined) {
    data.position = input.position;
  }

  if (input.published !== undefined) {
    data.published = input.published;
  }

  if (input.supportMaterialTitle !== undefined) {
    data.supportMaterialTitle = input.supportMaterialTitle?.trim() || null;
  }

  if (input.supportMaterialUrl !== undefined) {
    data.supportMaterialUrl = input.supportMaterialUrl?.trim() || null;
  }

  const [updated] = await db
    .update(masterclassLesson)
    .set(data)
    .where(eq(masterclassLesson.id, id))
    .returning();

  return updated ?? null;
}

export async function deleteMasterclassLesson(id: string) {
  const [deleted] = await db
    .delete(masterclassLesson)
    .where(eq(masterclassLesson.id, id))
    .returning();

  if (!deleted) return null;

  const remaining = await listMasterclassLessons(deleted.courseId);
  await reorderMasterclassLessons(
    deleted.courseId,
    remaining.map((lesson) => lesson.id),
  );

  return deleted;
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
