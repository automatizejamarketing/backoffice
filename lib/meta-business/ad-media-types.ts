export type AdMediaLayout =
  | "single_image"
  | "single_video"
  | "carousel"
  | "dynamic"
  | "instagram_post"
  | "unknown";

export type AdMediaItem = {
  key: string;
  kind: "image" | "video";
  previewUrl: string;
  posterUrl?: string;
  downloadUrl?: string;
  downloadFilename?: string;
  videoStatus?: "ready" | "processing" | "error";
  videoErrorMessage?: string;
  name?: string;
};

export type GetAdMediaResponse = {
  adId: string;
  creativeId?: string;
  layout: AdMediaLayout;
  items: AdMediaItem[];
};

export type AdMediaErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};
