import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { instagramAccount } from "@/lib/db/schema";
import { metaApiCall } from "@/lib/meta-business/api";

/**
 * Instagram access tokens connected by a user, keyed by `instagram_user_id`
 * (plus a flat list for "any token" fallbacks).
 *
 * Why this exists: ads built from an Instagram Reel/post reference an IG-native
 * video. The underlying Facebook video node (`GET /{video-id}?fields=source`)
 * is unreadable even with the owning Page's token (Meta code 10), because the
 * media lives on Instagram. The IG Business Login token stored in
 * `instagram_accounts` CAN read it via the Instagram Graph API, returning a
 * playable `media_url`.
 *
 * Never throws: a DB hiccup here just yields empty maps, and the caller keeps
 * the existing Facebook-based behaviour.
 */
export async function getUserInstagramTokens(userId: string): Promise<{
  byUser: Map<string, string>;
  all: string[];
}> {
  const byUser = new Map<string, string>();
  const all: string[] = [];
  try {
    const rows = await db
      .select({
        instagramUserId: instagramAccount.instagramUserId,
        accessToken: instagramAccount.accessToken,
        tokenExpiresAt: instagramAccount.tokenExpiresAt,
      })
      .from(instagramAccount)
      .where(
        and(
          eq(instagramAccount.userId, userId),
          isNull(instagramAccount.deletedAt),
        ),
      )
      .orderBy(desc(instagramAccount.updatedAt));

    const now = Date.now();
    for (const row of rows) {
      if (row.tokenExpiresAt && new Date(row.tokenExpiresAt).getTime() <= now) {
        continue;
      }
      all.push(row.accessToken);
      if (row.instagramUserId) byUser.set(row.instagramUserId, row.accessToken);
    }
  } catch (err) {
    console.warn("Falha ao obter tokens de Instagram:", err);
  }
  return { byUser, all };
}

export type InstagramMediaResolved = {
  mediaUrl?: string;
  thumbnailUrl?: string;
  permalink?: string;
  mediaType?: string;
};

/**
 * Resolves an Instagram media id to a playable `media_url` via the Instagram
 * Graph API (graph.instagram.com). Returns null on any failure or when there's
 * no `media_url` (e.g. an image-only post or an id the token can't read).
 * Never throws.
 */
export async function resolveInstagramMedia(
  mediaId: string,
  igToken: string,
): Promise<InstagramMediaResolved | null> {
  try {
    const res = await metaApiCall<{
      media_type?: string;
      media_url?: string;
      thumbnail_url?: string;
      permalink?: string;
    }>({
      domain: "INSTAGRAM",
      method: "GET",
      path: mediaId,
      params: "fields=media_type,media_url,thumbnail_url,permalink",
      accessToken: igToken,
    });
    if (!res.media_url) return null;
    return {
      mediaUrl: res.media_url,
      thumbnailUrl: res.thumbnail_url,
      permalink: res.permalink,
      mediaType: res.media_type,
    };
  } catch (err) {
    console.warn(`Falha ao resolver mídia do Instagram ${mediaId}:`, err);
    return null;
  }
}
