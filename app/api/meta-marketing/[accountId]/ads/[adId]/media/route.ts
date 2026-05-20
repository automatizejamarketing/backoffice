import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
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
};

type Draft = ImageDraft | VideoDraft;

const CREATIVE_FIELDS = [
  "id",
  "object_type",
  "image_url",
  "image_hash",
  "thumbnail_url",
  "video_id",
  "object_story_spec{link_data{picture,image_hash,child_attachments{picture,image_hash,video_id,name,description,link}},video_data{video_id,image_url,image_hash},template_data{picture,image_hash}}",
  "asset_feed_spec{images{hash,url},videos{video_id,thumbnail_url}}",
  "source_instagram_media_id",
].join(",");

const VIDEO_FIELDS = "source,picture,permalink_url,status,length,format";
const ADIMAGE_FIELDS = "hash,url,permalink_url,width,height";

function slugify(input: string | undefined, fallback: string): string {
  const base = (input ?? "").toString().toLowerCase().trim();
  const cleaned = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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

    const hashes: string[] = Array.from(
      new Set(
        drafts
          .filter((d): d is ImageDraft => d.kind === "image" && !!d.hash && !d.previewUrl)
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

    const videoIds: string[] = Array.from(
      new Set(drafts.filter((d): d is VideoDraft => d.kind === "video").map((d) => d.videoId)),
    );

    const videoResults = new Map<string, GraphVideoResponse | { __error: true }>();
    if (videoIds.length > 0) {
      const settled = await Promise.allSettled(
        videoIds.map((vid) =>
          metaApiCall<GraphVideoResponse>({
            domain: "FACEBOOK",
            method: "GET",
            path: vid,
            params: `fields=${VIDEO_FIELDS}`,
            accessToken,
          }),
        ),
      );
      settled.forEach((res, idx) => {
        const vid = videoIds[idx];
        if (res.status === "fulfilled") {
          videoResults.set(vid, res.value);
        } else {
          console.warn(`Falha ao resolver vídeo ${vid}:`, res.reason);
          videoResults.set(vid, { __error: true });
        }
      });
    }

    const items: AdMediaItem[] = [];
    drafts.forEach((draft, idx) => {
      if (draft.kind === "image") {
        const previewUrl =
          draft.previewUrl ??
          (draft.hash ? hashToUrl.get(draft.hash) : undefined);
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
      const baseFilename = slugify(adShallow.name, adShallow.id ?? adId);
      const filename = `${baseFilename}${drafts.length > 1 ? `-${idx + 1}` : ""}.mp4`;

      if (!videoData || "__error" in videoData) {
        items.push({
          key: `vid-${idx}-${draft.videoId}`,
          kind: "video",
          previewUrl: draft.posterUrl ?? "",
          posterUrl: draft.posterUrl,
          videoStatus: "error",
          videoErrorMessage: "Não foi possível obter informações deste vídeo.",
          name: draft.name,
        });
        return;
      }

      const status = videoData.status?.video_status;
      const poster = draft.posterUrl ?? videoData.picture;

      if (status === "ready" && videoData.source) {
        items.push({
          key: `vid-${idx}-${draft.videoId}`,
          kind: "video",
          previewUrl: videoData.source,
          posterUrl: poster,
          videoStatus: "ready",
          downloadUrl: buildDownloadUrl({
            accountId,
            adId,
            userId,
            kind: "video",
            url: videoData.source,
            filename,
          }),
          downloadFilename: filename,
          name: draft.name,
        });
        return;
      }

      if (status === "processing") {
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

      items.push({
        key: `vid-${idx}-${draft.videoId}`,
        kind: "video",
        previewUrl: poster ?? "",
        posterUrl: poster,
        videoStatus: "error",
        videoErrorMessage: status
          ? `Status do vídeo: ${status}.`
          : "O vídeo não está pronto para download.",
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
