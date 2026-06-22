import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { metaApiCall } from "@/lib/meta-business/api";
import {
  errorToGraphErrorReturn,
  GraphApiError,
} from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getManagedPageTokens } from "@/lib/meta-business/get-page-tokens";
import {
  getUserInstagramTokens,
  resolveInstagramMedia,
  type InstagramMediaResolved,
} from "@/lib/meta-business/get-instagram-media";
import type {
  AdMediaErrorResponse,
  AdMediaItem,
  AdMediaLayout,
  GetAdMediaResponse,
} from "@/lib/meta-business/ad-media-types";

type GraphAdShallow = {
  id: string;
  name?: string;
  creative?: { id: string };
};

type GraphChildAttachment = {
  picture?: string;
  image_hash?: string;
  video_id?: string;
  name?: string;
  description?: string;
  link?: string;
};

type GraphLinkData = {
  picture?: string;
  image_hash?: string;
  child_attachments?: GraphChildAttachment[];
};

type GraphVideoData = {
  video_id?: string;
  image_url?: string;
  image_hash?: string;
};

type GraphTemplateData = {
  picture?: string;
  image_hash?: string;
};

type GraphObjectStorySpec = {
  page_id?: string;
  instagram_user_id?: string;
  link_data?: GraphLinkData;
  video_data?: GraphVideoData;
  template_data?: GraphTemplateData;
};

type GraphAssetFeedImage = {
  hash?: string;
  url?: string;
};

type GraphAssetFeedVideo = {
  video_id?: string;
  thumbnail_url?: string;
};

type GraphAssetFeedSpec = {
  images?: GraphAssetFeedImage[];
  videos?: GraphAssetFeedVideo[];
};

type GraphCreativeFull = {
  id: string;
  object_type?: string;
  image_url?: string;
  image_hash?: string;
  thumbnail_url?: string;
  video_id?: string;
  object_story_spec?: GraphObjectStorySpec;
  asset_feed_spec?: GraphAssetFeedSpec;
  source_instagram_media_id?: string;
  effective_instagram_media_id?: string;
  instagram_permalink_url?: string;
  instagram_user_id?: string;
  effective_object_story_id?: string;
  object_story_id?: string;
  object_id?: string;
};

type GraphAdImagesResponse = {
  data?: Array<{
    hash?: string;
    url?: string;
    permalink_url?: string;
    width?: number;
    height?: number;
  }>;
};

type GraphVideoResponse = {
  id?: string;
  source?: string;
  picture?: string;
  permalink_url?: string;
  status?: {
    video_status?: "ready" | "processing" | "error" | string;
    processing_phase?: { progress?: number };
  };
  length?: number;
  format?: unknown;
};

type ImageDraft = {
  kind: "image";
  index: number;
  previewUrl?: string;
  hash?: string;
  name?: string;
};

type VideoDraft = {
  kind: "video";
  index: number;
  videoId: string;
  posterUrl?: string;
  name?: string;
  /**
   * Id of the Facebook Page that owns this video, when the ad was sourced from
   * an existing Page/Instagram post. Page-owned videos can't be read with the
   * user token (Meta code 10) — they need the owning Page's access token.
   */
  owningPageId?: string;
};

type Draft = ImageDraft | VideoDraft;

const CREATIVE_FIELDS = [
  "id",
  "object_type",
  "image_url",
  "image_hash",
  "thumbnail_url",
  "video_id",
  "object_story_spec{page_id,instagram_user_id,link_data{picture,image_hash,child_attachments{picture,image_hash,video_id,name,description,link}},video_data{video_id,image_url,image_hash},template_data{picture,image_hash}}",
  "asset_feed_spec{images{hash,url},videos{video_id,thumbnail_url}}",
  "source_instagram_media_id",
  "effective_instagram_media_id",
  "instagram_permalink_url",
  "instagram_user_id",
  "effective_object_story_id",
  "object_story_id",
  "object_id",
].join(",");

const VIDEO_FIELDS = "source,picture,permalink_url,status,length,format";
const ADIMAGE_FIELDS = "hash,url,permalink_url,width,height";

// Shown when a Page/Instagram-owned video can't be resolved to a downloadable
// source (most commonly because the advertiser doesn't manage the owning Page).
// Paired with a permalink so the user can still open the original publication.
const PAGE_OWNED_UNRESOLVED_MESSAGE =
  "Este vídeo pertence a uma Página/Instagram e não pôde ser baixado por aqui. Você pode abri-lo no Facebook/Instagram pelo link abaixo.";

// Meta's video endpoint returns a generic "unexpected error" for short bursts
// of transient failures. Retry twice with growing backoff before giving up so
// a single hiccup doesn't leave the UI permanently stuck on "Não foi possível
// obter informações deste vídeo".
const VIDEO_RETRY_DELAYS_MS = [500, 1500] as const;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchVideoWithRetry(
  videoId: string,
  accessToken: string,
): Promise<GraphVideoResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= VIDEO_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await metaApiCall<GraphVideoResponse>({
        domain: "FACEBOOK",
        method: "GET",
        path: videoId,
        params: `fields=${VIDEO_FIELDS}`,
        accessToken,
      });
    } catch (err) {
      lastErr = err;
      const isTransient =
        err instanceof GraphApiError && err.errorReturn.reason.isTransient;
      if (!isTransient || attempt >= VIDEO_RETRY_DELAYS_MS.length) break;
      await delay(VIDEO_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastErr;
}

type VideoFetchError = { __error: true; message: string };

function describeVideoError(err: unknown): string {
  if (err instanceof GraphApiError) {
    const { data, reason } = err.errorReturn;
    // Prefer the real Meta message (data.*) over the generic mapped reason, so
    // an unmapped code (e.g. 10 "Application does not have permission") surfaces
    // its actual cause instead of the catch-all "erro inesperado".
    return (
      data?.errorUserMsg ??
      data?.message ??
      reason.message ??
      reason.title ??
      "Erro desconhecido da Meta."
    );
  }
  if (err instanceof Error) return err.message;
  return "Erro desconhecido.";
}

/** Page id prefix of a Graph story id formatted `{page_id}_{post_id}`. */
function pageIdFromStoryId(storyId: string | undefined): string | undefined {
  const [pageId] = storyId?.split("_") ?? [];
  return pageId || undefined;
}

/**
 * Resolves the Page that owns a creative's media, mirroring the resolution
 * order used elsewhere for promotion edits (see marketing/promotion-link-edit).
 * Returns undefined for account-owned creatives (no page backing).
 */
function resolveOwningPageId(
  creative: GraphCreativeFull,
): string | undefined {
  return (
    creative.object_id ??
    creative.object_story_spec?.page_id ??
    pageIdFromStoryId(creative.effective_object_story_id) ??
    pageIdFromStoryId(creative.object_story_id)
  );
}

/**
 * Best-effort public link to view a Page/Instagram-owned video that we can't
 * resolve to a downloadable source. Prefers the Graph `permalink_url`, then the
 * canonical post URL from `effective_object_story_id`, then a Page video URL.
 */
function buildVideoPermalink(args: {
  graphPermalink?: string;
  effectiveObjectStoryId?: string;
  owningPageId?: string;
  videoId?: string;
}): string | undefined {
  const { graphPermalink, effectiveObjectStoryId, owningPageId, videoId } =
    args;
  if (graphPermalink) {
    return graphPermalink.startsWith("/")
      ? `https://www.facebook.com${graphPermalink}`
      : graphPermalink;
  }
  if (effectiveObjectStoryId) {
    return `https://www.facebook.com/${effectiveObjectStoryId}`;
  }
  if (owningPageId && videoId) {
    return `https://www.facebook.com/${owningPageId}/videos/${videoId}`;
  }
  return undefined;
}

function slugify(input: string | undefined, fallback: string): string {
  const base = (input ?? "").toString().toLowerCase().trim();
  // The filename ends up in a `Content-Disposition: filename="..."` header
  // downstream, which is a ByteString — any code point > 255 (em dash U+2014,
  // ellipsis U+2026, fancy quotes, ...) makes Node's Headers constructor
  // throw at runtime. So we strip everything outside ASCII after stripping
  // combining diacritics from accented characters.
  const cleaned = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x00-\x7f]/g, "-")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const out = cleaned.length > 0 ? cleaned : fallback;
  return out.slice(0, 80);
}

function buildDownloadUrl(args: {
  accountId: string;
  adId: string;
  userId: string;
  kind: "image" | "video";
  url: string;
  filename: string;
}): string {
  const qs = new URLSearchParams({
    userId: args.userId,
    kind: args.kind,
    url: args.url,
    filename: args.filename,
  });
  return `/api/meta-marketing/${args.accountId}/ads/${args.adId}/media/download?${qs.toString()}`;
}

function inferImageExt(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (path.endsWith(".png")) return "png";
    if (path.endsWith(".webp")) return "webp";
    if (path.endsWith(".gif")) return "gif";
    return "jpg";
  } catch {
    return "jpg";
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; adId: string }> },
): Promise<NextResponse<GetAdMediaResponse | AdMediaErrorResponse>> {
  try {
    const { accountId, adId } = await params;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        {
          error: "Missing userId",
          message: "userId query parameter is required",
          solution: "Provide userId to identify which user's token to use",
        },
        { status: 400 },
      );
    }

    const authz = await requireMarketingUserAccessResponse(userId);
    if (!authz.ok) return authz.response;

    const tokenResult = await getUserAccessTokenByUserId(userId);
    if (!tokenResult.success) {
      return NextResponse.json(
        {
          error: tokenResult.error.error,
          message: tokenResult.error.message,
          solution: tokenResult.error.solution,
        },
        { status: tokenResult.error.statusCode },
      );
    }
    const { accessToken } = tokenResult;

    const formattedAccountId = accountId.startsWith("act_")
      ? accountId
      : `act_${accountId}`;

    const adShallow = await metaApiCall<GraphAdShallow>({
      domain: "FACEBOOK",
      method: "GET",
      path: adId,
      params: "fields=id,name,creative{id}",
      accessToken,
    });

    const creativeId = adShallow.creative?.id;
    if (!creativeId) {
      return NextResponse.json(
        { adId, creativeId: undefined, layout: "unknown", items: [] },
        { status: 200 },
      );
    }

    const creative = await metaApiCall<GraphCreativeFull>({
      domain: "FACEBOOK",
      method: "GET",
      path: creativeId,
      params: `fields=${CREATIVE_FIELDS}`,
      accessToken,
    });

    const { drafts, layout } = aggregateDrafts(creative);

    if (drafts.length === 0) {
      return NextResponse.json(
        { adId, creativeId, layout: "unknown", items: [] },
        { status: 200 },
      );
    }

    // Collect every image hash, even when the draft already carries a low-res
    // `previewUrl` (e.g. carousel `picture`, single-image `image_url`). We
    // then prefer the high-res `/adimages` URL at merge time, falling back to
    // the low-res only when Meta couldn't resolve the hash.
    const hashes: string[] = Array.from(
      new Set(
        drafts
          .filter((d): d is ImageDraft => d.kind === "image" && !!d.hash)
          .map((d) => d.hash as string),
      ),
    );

    const hashToUrl = new Map<string, string>();
    if (hashes.length > 0) {
      try {
        const adimages = await metaApiCall<GraphAdImagesResponse>({
          domain: "FACEBOOK",
          method: "GET",
          path: `${formattedAccountId}/adimages`,
          params: `hashes=${encodeURIComponent(JSON.stringify(hashes))}&fields=${ADIMAGE_FIELDS}`,
          accessToken,
        });
        for (const row of adimages.data ?? []) {
          if (row.hash && row.url) {
            hashToUrl.set(row.hash, row.url);
          }
        }
      } catch (err) {
        console.warn("Falha ao resolver image hashes:", err);
      }
    }

    // De-dup video jobs by id, carrying the owning Page (all videos in a
    // creative share one owning Page, so the first occurrence wins).
    const videoJobs = new Map<string, { owningPageId?: string }>();
    for (const d of drafts) {
      if (d.kind === "video" && !videoJobs.has(d.videoId)) {
        videoJobs.set(d.videoId, { owningPageId: d.owningPageId });
      }
    }

    // Videos sourced from an existing Instagram/Page post are owned by the
    // Page, not the ad account — the user token can't read them (Meta code 10).
    // Fetch the managed Pages' tokens once and read those videos with the
    // owning Page's token. Account-owned videos keep using the user token, so
    // there's no extra call when nothing is page-owned.
    const anyPageOwnedVideo = Array.from(videoJobs.values()).some(
      (job) => job.owningPageId,
    );
    const pageTokens = anyPageOwnedVideo
      ? await getManagedPageTokens(accessToken)
      : new Map<string, string>();

    const videoResults = new Map<string, GraphVideoResponse | VideoFetchError>();
    if (videoJobs.size > 0) {
      const jobEntries = Array.from(videoJobs.entries());
      const settled = await Promise.allSettled(
        jobEntries.map(([vid, job]) => {
          const token =
            (job.owningPageId && pageTokens.get(job.owningPageId)) ||
            accessToken;
          return fetchVideoWithRetry(vid, token);
        }),
      );
      settled.forEach((res, idx) => {
        const [vid] = jobEntries[idx];
        if (res.status === "fulfilled") {
          videoResults.set(vid, res.value);
        } else {
          const message = describeVideoError(res.reason);
          console.warn(`Falha ao resolver vídeo ${vid}: ${message}`);
          videoResults.set(vid, { __error: true, message });
        }
      });
    }

    const effectiveObjectStoryId = creative.effective_object_story_id;

    // Instagram fallback context. Ads built from an IG Reel/post reference an
    // IG-native video whose Facebook node is unreadable even with the owning
    // Page's token (code 10 — the media lives on Instagram). When the creative
    // is IG-sourced and has exactly one video, resolve it via the Instagram
    // Graph API with the user's IG token (matched to the creative's IG account).
    const igMediaId =
      creative.effective_instagram_media_id ??
      creative.source_instagram_media_id;
    const igPostUrl = creative.instagram_permalink_url;
    const creativeIgUserId =
      creative.instagram_user_id ??
      creative.object_story_spec?.instagram_user_id;

    const igResolved = new Map<string, InstagramMediaResolved>();
    const videoDraftsList = drafts.filter(
      (d): d is VideoDraft => d.kind === "video",
    );
    if (igMediaId && videoDraftsList.length === 1) {
      const onlyVideo = videoDraftsList[0];
      const fb = videoResults.get(onlyVideo.videoId);
      const fbReady =
        !!fb &&
        !("__error" in fb) &&
        fb.status?.video_status === "ready" &&
        !!fb.source;
      const fbProcessing =
        !!fb && !("__error" in fb) && fb.status?.video_status === "processing";
      // Only reach for Instagram when Facebook couldn't hand us a playable
      // source and the video isn't still processing — keeps every currently
      // working path (account videos, Page-owned videos) untouched.
      if (!fbReady && !fbProcessing) {
        const igTokens = await getUserInstagramTokens(userId);
        const igToken =
          (creativeIgUserId && igTokens.byUser.get(creativeIgUserId)) ||
          igTokens.all[0];
        if (igToken) {
          const resolved = await resolveInstagramMedia(igMediaId, igToken);
          if (resolved?.mediaUrl) igResolved.set(onlyVideo.videoId, resolved);
        }
      }
    }

    const items: AdMediaItem[] = [];
    drafts.forEach((draft, idx) => {
      if (draft.kind === "image") {
        // `picture`/`image_url` returned inline on creatives are CDN thumbs
        // (~400px wide). The `/adimages?fields=url` response gives the full
        // resolution upload, which is what users actually want when they
        // download or zoom. Prefer the resolved URL when both exist.
        const resolvedHashUrl = draft.hash
          ? hashToUrl.get(draft.hash)
          : undefined;
        const previewUrl = resolvedHashUrl ?? draft.previewUrl;
        if (!previewUrl) return;
        const ext = inferImageExt(previewUrl);
        const baseFilename = slugify(adShallow.name, adShallow.id ?? adId);
        const filename = `${baseFilename}${drafts.length > 1 ? `-${idx + 1}` : ""}.${ext}`;
        items.push({
          key: `img-${idx}-${draft.hash ?? previewUrl.slice(-40)}`,
          kind: "image",
          previewUrl,
          downloadUrl: buildDownloadUrl({
            accountId,
            adId,
            userId,
            kind: "image",
            url: previewUrl,
            filename,
          }),
          downloadFilename: filename,
          name: draft.name,
        });
        return;
      }

      const videoData = videoResults.get(draft.videoId);
      const igFallback = igResolved.get(draft.videoId);
      const baseFilename = slugify(adShallow.name, adShallow.id ?? adId);
      const filename = `${baseFilename}${drafts.length > 1 ? `-${idx + 1}` : ""}.mp4`;

      const fbOk =
        videoData && !("__error" in videoData) ? videoData : undefined;
      const fbStatus = fbOk?.status?.video_status;
      const poster = draft.posterUrl ?? fbOk?.picture ?? igFallback?.thumbnailUrl;

      // 1. Facebook resolved a playable source (account-uploaded videos and
      //    Page-owned regular videos). Unchanged from before.
      if (fbStatus === "ready" && fbOk?.source) {
        items.push({
          key: `vid-${idx}-${draft.videoId}`,
          kind: "video",
          previewUrl: fbOk.source,
          posterUrl: poster,
          videoStatus: "ready",
          downloadUrl: buildDownloadUrl({
            accountId,
            adId,
            userId,
            kind: "video",
            url: fbOk.source,
            filename,
          }),
          downloadFilename: filename,
          name: draft.name,
        });
        return;
      }

      // 2. Instagram fallback resolved a media_url — IG-native Reels whose
      //    Facebook node is unreadable even with the owning Page's token.
      if (igFallback?.mediaUrl) {
        items.push({
          key: `vid-${idx}-${draft.videoId}`,
          kind: "video",
          previewUrl: igFallback.mediaUrl,
          posterUrl: poster,
          videoStatus: "ready",
          downloadUrl: buildDownloadUrl({
            accountId,
            adId,
            userId,
            kind: "video",
            url: igFallback.mediaUrl,
            filename,
          }),
          downloadFilename: filename,
          name: draft.name,
        });
        return;
      }

      // 3. Facebook says the video is still being processed by Meta.
      if (fbStatus === "processing") {
        items.push({
          key: `vid-${idx}-${draft.videoId}`,
          kind: "video",
          previewUrl: poster ?? "",
          posterUrl: poster,
          videoStatus: "processing",
          name: draft.name,
        });
        return;
      }

      // 4. Page/Instagram-owned video we couldn't resolve to a source. Degrade
      //    gracefully: poster + permalink (prefer the real IG post URL), no
      //    download, with a clear reason instead of the generic error.
      if (draft.owningPageId || igMediaId) {
        items.push({
          key: `vid-${idx}-${draft.videoId}`,
          kind: "video",
          previewUrl: poster ?? "",
          posterUrl: poster,
          videoStatus: "error",
          videoErrorMessage: PAGE_OWNED_UNRESOLVED_MESSAGE,
          permalinkUrl:
            igPostUrl ??
            buildVideoPermalink({
              graphPermalink: fbOk?.permalink_url,
              effectiveObjectStoryId,
              owningPageId: draft.owningPageId,
              videoId: draft.videoId,
            }),
          name: draft.name,
        });
        return;
      }

      // 5. Account-owned video that still failed — surface the real Meta error
      //    (or status) instead of the generic one.
      const detail =
        videoData && "__error" in videoData ? videoData.message : undefined;
      items.push({
        key: `vid-${idx}-${draft.videoId}`,
        kind: "video",
        previewUrl: poster ?? "",
        posterUrl: poster,
        videoStatus: "error",
        videoErrorMessage: detail
          ? `Não foi possível obter informações deste vídeo: ${detail}`
          : fbStatus
            ? `Status do vídeo: ${fbStatus}.`
            : "Não foi possível obter informações deste vídeo.",
        name: draft.name,
      });
    });

    return NextResponse.json(
      { adId, creativeId, layout, items },
      { status: 200 },
    );
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);
    console.error("Error fetching ad media:", errorReturn);
    return NextResponse.json(
      {
        error: errorReturn.reason.title,
        message: errorReturn.reason.message,
        solution: errorReturn.reason.solution,
      },
      { status: errorReturn.statusCode },
    );
  }
}

function aggregateDrafts(creative: GraphCreativeFull): {
  drafts: Draft[];
  layout: AdMediaLayout;
} {
  // Every video in a creative shares one owning Page (the creative-level
  // backing Page / Instagram identity), so resolve it once and stamp it on each
  // video draft.
  const owningPageId = resolveOwningPageId(creative);
  const linkData = creative.object_story_spec?.link_data;
  const children = linkData?.child_attachments;

  if (children && children.length > 0) {
    const drafts: Draft[] = children.map((c, idx): Draft => {
      if (c.video_id) {
        return {
          kind: "video",
          index: idx,
          videoId: c.video_id,
          posterUrl: c.picture,
          name: c.name,
          owningPageId,
        };
      }
      return {
        kind: "image",
        index: idx,
        previewUrl: c.picture,
        hash: c.image_hash,
        name: c.name,
      };
    });
    return { drafts, layout: "carousel" };
  }

  const feedImages = creative.asset_feed_spec?.images ?? [];
  const feedVideos = creative.asset_feed_spec?.videos ?? [];
  if (feedImages.length > 0 || feedVideos.length > 0) {
    const drafts: Draft[] = [];
    feedVideos.forEach((v, idx) => {
      if (v.video_id) {
        drafts.push({
          kind: "video",
          index: idx,
          videoId: v.video_id,
          posterUrl: v.thumbnail_url,
          owningPageId,
        });
      }
    });
    feedImages.forEach((img, idx) => {
      if (img.hash || img.url) {
        drafts.push({
          kind: "image",
          index: feedVideos.length + idx,
          previewUrl: img.url,
          hash: img.hash,
        });
      }
    });
    if (drafts.length > 0) {
      return { drafts, layout: "dynamic" };
    }
  }

  const videoData = creative.object_story_spec?.video_data;
  const topVideoId = videoData?.video_id ?? creative.video_id;
  if (topVideoId) {
    return {
      drafts: [
        {
          kind: "video",
          index: 0,
          videoId: topVideoId,
          posterUrl: videoData?.image_url ?? creative.thumbnail_url ?? creative.image_url,
          owningPageId,
        },
      ],
      layout: "single_video",
    };
  }

  const linkHash = linkData?.image_hash;
  const linkPicture = linkData?.picture;
  const topHash = creative.image_hash;
  const topUrl = creative.image_url ?? creative.thumbnail_url;

  if (linkHash || linkPicture) {
    return {
      drafts: [
        {
          kind: "image",
          index: 0,
          previewUrl: linkPicture,
          hash: linkHash,
        },
      ],
      layout: "single_image",
    };
  }

  if (topHash || topUrl) {
    if (creative.source_instagram_media_id && topUrl) {
      return {
        drafts: [{ kind: "image", index: 0, previewUrl: topUrl }],
        layout: "instagram_post",
      };
    }
    return {
      drafts: [
        {
          kind: "image",
          index: 0,
          previewUrl: topUrl,
          hash: topHash,
        },
      ],
      layout: topUrl && !topHash ? "unknown" : "single_image",
    };
  }

  return { drafts: [], layout: "unknown" };
}
