import { graphFacebookBaseUrl, graphApiVersion } from "../constant";

export type UploadAdVideoResponse = {
  id: string;
};

export type VideoStatusResponse = {
  id: string;
  status: {
    video_status: "ready" | "processing" | "error";
    uploading_phase?: {
      status: string;
      bytes_transferred?: number;
    };
    processing_phase?: {
      status: string;
      progress?: number;
    };
    publishing_phase?: {
      status: string;
      publish_status?: string;
      publish_time?: number;
    };
    error?: {
      message: string;
      error_code: number;
    };
  };
};

type FacebookGraphApiError = {
  error?: {
    message?: string;
  };
};

/**
 * Upload a video to a Facebook ad account from a public URL. Returns a video
 * id usable in ad creatives via `video_data.video_id`. Processing is
 * asynchronous — poll `getAdVideoStatus` before using the video in an ad.
 */
export async function uploadAdVideoFromUrl(
  adAccountId: string,
  accessToken: string,
  videoUrl: string,
  name?: string,
  description?: string,
): Promise<UploadAdVideoResponse> {
  const formData = new FormData();
  formData.append("file_url", videoUrl);
  formData.append("access_token", accessToken);

  if (name) {
    formData.append("name", name);
  }

  if (description) {
    formData.append("description", description);
  }

  const url = `${graphFacebookBaseUrl}/${graphApiVersion}/${adAccountId}/advideos`;

  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errorData = data as FacebookGraphApiError;
    console.error("Error uploading ad video:", errorData);
    throw new Error(errorData.error?.message ?? "Failed to upload ad video");
  }

  return data as UploadAdVideoResponse;
}

/**
 * Get the processing status of an uploaded video. Videos process
 * asynchronously after upload; an ad must not be created until the status is
 * `ready`.
 */
export async function getAdVideoStatus(
  videoId: string,
  accessToken: string,
): Promise<VideoStatusResponse> {
  const params = new URLSearchParams({
    fields: "id,status",
    access_token: accessToken,
  });

  const url = `${graphFacebookBaseUrl}/${graphApiVersion}/${videoId}?${params.toString()}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.error) {
    const errorData = data as FacebookGraphApiError;
    console.error("Error getting video status:", errorData);
    throw new Error(errorData.error?.message ?? "Failed to get video status");
  }

  return data as VideoStatusResponse;
}

/**
 * Poll the video status until it is `ready` or errors out. Used when an ad
 * must not be created until the video is fully processed by Meta.
 */
export async function waitForVideoReady(
  videoId: string,
  accessToken: string,
  maxAttempts = 60,
  intervalMs = 5000,
): Promise<VideoStatusResponse> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await getAdVideoStatus(videoId, accessToken);

    if (status.status.video_status === "ready") {
      return status;
    }

    if (status.status.video_status === "error") {
      throw new Error(
        `Video processing failed: ${
          status.status.error?.message ?? "Unknown error"
        }`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Video processing timed out after ${
      (maxAttempts * intervalMs) / 1000
    } seconds`,
  );
}
