import "server-only";

import { callMeta } from "@/lib/meta-business/insights/client";
import { extractObservedWebsiteEvents, type WebsiteSource } from "./website";

type PixelLike = Pick<WebsiteSource, "id" | "name" | "lastFiredTime" | "isUnavailable"> & { last_fired_time?: string; is_unavailable?: boolean };
/**
 * Reads the events the source received in the last 7 days from any origin:
 * Meta builds website audiences from Pixel and Conversions API events alike.
 * Failures stay explicit as unknown.
 */
export async function discoverWebsiteSources(pixels: ReadonlyArray<PixelLike>, accessToken: string): Promise<WebsiteSource[]> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 7 * 24 * 60 * 60;
  return Promise.all(pixels.map(async (pixel) => {
    const base: WebsiteSource = {
      id: pixel.id,
      ...(pixel.name ? { name: pixel.name } : {}),
      ...(pixel.lastFiredTime || pixel.last_fired_time ? { lastFiredTime: pixel.lastFiredTime ?? pixel.last_fired_time } : {}),
      ...(pixel.isUnavailable !== undefined || pixel.is_unavailable !== undefined ? { isUnavailable: pixel.isUnavailable ?? pixel.is_unavailable } : {}),
    };
    if (base.isUnavailable === true) return { ...base, observedEvents: [], observedEventsStatus: "unknown" as const };
    try {
      const stats = await callMeta<{ data?: unknown }>({ method: "GET", path: `${pixel.id}/stats`, params: `aggregation=event&start_time=${start}&end_time=${end}`, accessToken }, { retryOnRateLimit: true });
      const observedEvents = extractObservedWebsiteEvents(stats);
      return { ...base, observedEvents, observedEventsStatus: observedEvents.length ? "available" as const : "unavailable" as const, observedEventsObservedAt: new Date().toISOString() };
    } catch {
      return { ...base, observedEvents: [], observedEventsStatus: "unknown" as const };
    }
  }));
}
