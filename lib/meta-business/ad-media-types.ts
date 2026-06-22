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
  /**
   * Link to view the media on Facebook/Instagram. Set on the degraded path when
   * a Page/Instagram-owned video can't be resolved to a downloadable source
   * (the advertiser doesn't manage the owning Page), so the user can still open
   * the original publication.
   */
  permalinkUrl?: string;
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
