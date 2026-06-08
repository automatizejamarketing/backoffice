import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  trackableLink,
  trackableLinkClick,
  user,
  type TrackableLink,
} from "@/lib/db/schema";
import { slugifyName } from "./slug";

/** True if the slug already exists for ANY link, including soft-deleted ones. */
async function slugExistsIncludingDeleted(slug: string): Promise<boolean> {
  const [row] = await db
    .select({ id: trackableLink.id })
    .from(trackableLink)
    .where(eq(trackableLink.slug, slug))
    .limit(1);
  return Boolean(row);
}

/**
 * Derive a slug from the name; if it already exists (incl. soft-deleted), append
 * a short random suffix and retry until unique. Slugs are never reused, so the
 * check must span deleted rows.
 */
export async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugifyName(name);
  if (!(await slugExistsIncludingDeleted(base))) return base;
  for (let i = 0; i < 10; i++) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = `${base}-${suffix}`;
    if (!(await slugExistsIncludingDeleted(candidate))) return candidate;
  }
  // Extremely unlikely fallback — a longer suffix.
  return `${base}-${Math.random().toString(36).slice(2, 10)}`;
}

/** True if an ACTIVE (non-deleted) link already uses this name (case-insensitive). */
export async function activeNameExists(name: string): Promise<boolean> {
  const [row] = await db
    .select({ id: trackableLink.id })
    .from(trackableLink)
    .where(
      and(
        sql`lower(${trackableLink.name}) = lower(${name})`,
        isNull(trackableLink.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function createTrackableLink(data: {
  name: string;
  createdBy?: string | null;
}): Promise<TrackableLink> {
  const slug = await generateUniqueSlug(data.name);
  const [result] = await db
    .insert(trackableLink)
    .values({
      name: data.name,
      slug,
      createdBy: data.createdBy ?? null,
    })
    .returning();
  return result;
}

/** Rename a link. The slug is immutable and is never touched here. */
export async function renameTrackableLink(
  id: string,
  name: string,
): Promise<void> {
  await db
    .update(trackableLink)
    .set({ name, updatedAt: new Date() })
    .where(eq(trackableLink.id, id));
}

export async function softDeleteTrackableLink(id: string): Promise<void> {
  await db
    .update(trackableLink)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(trackableLink.id, id));
}

export async function getActiveTrackableLinkById(
  id: string,
): Promise<TrackableLink | null> {
  const [row] = await db
    .select()
    .from(trackableLink)
    .where(and(eq(trackableLink.id, id), isNull(trackableLink.deletedAt)))
    .limit(1);
  return row ?? null;
}

export type TrackableLinkWithCounts = TrackableLink & {
  clicks: number;
  signups: number;
};

/**
 * List active links with their click count (rows in trackable_link_clicks) and
 * signup count (users whose referred_by_trackable_link_id points at the link).
 */
export async function listTrackableLinksWithCounts(): Promise<
  TrackableLinkWithCounts[]
> {
  const links = await db
    .select()
    .from(trackableLink)
    .where(isNull(trackableLink.deletedAt))
    .orderBy(desc(trackableLink.createdAt));

  if (links.length === 0) return [];

  const ids = links.map((l) => l.id);

  const [clickRows, signupRows] = await Promise.all([
    db
      .select({ linkId: trackableLinkClick.trackableLinkId, total: count() })
      .from(trackableLinkClick)
      .where(inArray(trackableLinkClick.trackableLinkId, ids))
      .groupBy(trackableLinkClick.trackableLinkId),
    db
      .select({ linkId: user.referredByTrackableLinkId, total: count() })
      .from(user)
      .where(inArray(user.referredByTrackableLinkId, ids))
      .groupBy(user.referredByTrackableLinkId),
  ]);

  const clickMap = new Map<string, number>(
    clickRows.map((r): [string, number] => [r.linkId, Number(r.total)]),
  );
  const signupMap = new Map<string, number>(
    signupRows.map((r): [string, number] => [r.linkId as string, Number(r.total)]),
  );

  return links.map((l) => ({
    ...l,
    clicks: clickMap.get(l.id) ?? 0,
    signups: signupMap.get(l.id) ?? 0,
  }));
}
