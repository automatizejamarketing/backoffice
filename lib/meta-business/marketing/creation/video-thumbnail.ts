import type { AdCreativeInput } from "./create-ad";

/**
 * A video ad must show a frame of THAT video. The model often copies the first
 * image it saw (another creative's jpg) into `thumbnailUrl`, and Ads Manager
 * then renders every ad as the same creative.
 *
 * When Meta already has a picture for this video id, use it. Otherwise drop a
 * thumbnail URL that does not belong to the video.
 */
export function applyOwnVideoThumbnail(
  creative: AdCreativeInput,
  picture: string | null,
): AdCreativeInput {
  if (creative.format !== "video" || !creative.videoId) {
    return creative;
  }
  if (picture) {
    return { ...creative, thumbnailUrl: picture };
  }
  if (
    creative.thumbnailUrl &&
    !creative.thumbnailUrl.includes(creative.videoId)
  ) {
    const { thumbnailUrl: _foreign, ...rest } = creative;
    return rest;
  }
  return creative;
}

type CreativeVideoSource = {
  video_id?: string;
  object_story_spec?:
    | { video_data?: { video_id?: string } }
    | string
    | null;
};

export function creativeVideoId(creative: CreativeVideoSource | null | undefined): string | null {
  if (!creative) return null;
  if (typeof creative.video_id === "string" && creative.video_id) {
    return creative.video_id;
  }
  const spec = creative.object_story_spec;
  if (!spec) return null;
  if (typeof spec === "string") {
    try {
      const parsed = JSON.parse(spec) as { video_data?: { video_id?: string } };
      return parsed.video_data?.video_id || null;
    } catch {
      return null;
    }
  }
  return spec.video_data?.video_id || null;
}

export function adSetAlreadyHasVideo(
  ads: ReadonlyArray<{ id?: string; creative?: CreativeVideoSource | null }>,
  videoId: string,
): string | null {
  for (const ad of ads) {
    if (creativeVideoId(ad.creative) === videoId) {
      return ad.id || videoId;
    }
  }
  return null;
}
