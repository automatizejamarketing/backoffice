import { fetchMetaGraph } from "@/lib/observability/meta-fetch";
import { graphFacebookBaseUrl, graphApiVersion } from "../constant";
import { throwMetaError } from "./meta-error";

type UploadVideoResult = {
  id: string;
  thumbnailUrl: string;
};

/**
 * Upload a video to a Meta ad account from a public URL (Meta fetches it
 * server-to-server) and resolve an auto-generated thumbnail. Processing is
 * asynchronous — the caller must poll `getAdVideoStatus` until ready before
 * creating the video ad creative.
 */
export async function uploadVideoToMeta(params: {
  adAccountId: string;
  accessToken: string;
  videoUrl: string;
  title?: string;
}): Promise<UploadVideoResult> {
  const { adAccountId, accessToken, videoUrl, title } = params;

  const formData = new FormData();
  formData.append("file_url", videoUrl);
  formData.append("access_token", accessToken);
  if (title) {
    formData.append("title", title);
  }

  const url = `${graphFacebookBaseUrl}/${graphApiVersion}/${adAccountId}/advideos`;

  const { response, data } = await fetchMetaGraph(url, {
    method: "POST",
    body: formData,
    requestParams: formData,
  });

  if (!response.ok || (data as { error?: unknown }).error) {
    console.error("[uploadVideoToMeta] Error uploading video:", data);
    throwMetaError(data, response.status);
  }

  const videoId = (data as { id: string }).id;

  // `picture` is available shortly after upload, before full processing.
  let thumbnailUrl = "";
  try {
    const thumbResponse = await fetch(
      `${graphFacebookBaseUrl}/${graphApiVersion}/${videoId}?fields=picture&access_token=${accessToken}`,
    );
    const thumbData = await thumbResponse.json();
    if (thumbData.picture) {
      thumbnailUrl = thumbData.picture;
    }
  } catch {
    console.warn(
      "[uploadVideoToMeta] Could not fetch video thumbnail, will use empty string",
    );
  }

  // Fallback: let Meta extract a frame from the source video URL.
  if (!thumbnailUrl) {
    thumbnailUrl = videoUrl;
  }

  return { id: videoId, thumbnailUrl };
}
