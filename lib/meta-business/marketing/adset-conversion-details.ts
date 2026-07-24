import { extractPromotionUrl } from "@/lib/meta-business/marketing/promotion-link-edit";
import type { GraphApiAd, GraphApiAdSet } from "@/lib/meta-business/types";

export type AdSetConversionDetails = {
  destinationType?: string;
  pixelId?: string;
  pixelName?: string;
  customEventType?: string;
  destinationUrls: string[];
};

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

export function extractPixelIdFromPromotedObject(
  promotedObject: Record<string, unknown> | undefined,
): string | undefined {
  if (!promotedObject) return undefined;
  return asNonEmptyString(promotedObject.pixel_id);
}

export function extractCustomEventTypeFromPromotedObject(
  promotedObject: Record<string, unknown> | undefined,
): string | undefined {
  if (!promotedObject) return undefined;
  return asNonEmptyString(promotedObject.custom_event_type);
}

export function collectDestinationUrlsFromAds(
  ads: GraphApiAd[] | undefined,
): string[] {
  if (!ads || ads.length === 0) return [];

  const urls = new Set<string>();
  for (const ad of ads) {
    const creative = ad.creative;
    if (!creative) continue;
    const url = extractPromotionUrl(
      creative as Parameters<typeof extractPromotionUrl>[0],
    );
    if (url) urls.add(url);
  }
  return [...urls];
}

export function buildAdSetConversionDetails(args: {
  adSet: GraphApiAdSet;
  pixelNameById?: Map<string, string>;
}): AdSetConversionDetails {
  const promotedObject = args.adSet.promoted_object;
  const pixelId = extractPixelIdFromPromotedObject(promotedObject);
  const pixelName = pixelId
    ? args.pixelNameById?.get(pixelId)
    : undefined;

  return {
    destinationType: asNonEmptyString(args.adSet.destination_type),
    pixelId,
    pixelName,
    customEventType: extractCustomEventTypeFromPromotedObject(promotedObject),
    destinationUrls: collectDestinationUrlsFromAds(args.adSet.ads?.data),
  };
}
