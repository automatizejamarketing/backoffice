/**
 * Ad-account Meta Pixels read for the marketing chatbot.
 *
 * The pixel `id` is campaign-ready: it's the `pixel_id` used in
 * `promoted_object` for conversion optimization and in the Conversions API.
 * Routes through {@link callMeta} (v25.0) for consistent logging/errors, reusing
 * the endpoint/fields already proven in `get-ad-account-pixels.ts`.
 *
 * Advertising identities (Facebook Pages + connected Instagram) are NOT here —
 * they live in the single source of truth `getAdvertisingIdentities`
 * (lib/meta-business/marketing/get-instagram-connected-page.ts), shared by the
 * chatbot tool, the campaign wizard API, and the backoffice identity picker.
 */
import type { GraphPaging } from "@/lib/meta-business/types";
import { callMeta, formatAccountId, type MetaCtx } from "./client";

const PIXEL_FIELDS =
  "id,name,last_fired_time,creation_time,is_unavailable,data_use_setting";

type RawPixel = {
  id: string;
  name?: string;
  last_fired_time?: string;
  creation_time?: string;
  is_unavailable?: boolean;
  data_use_setting?: string;
};

export type PixelInfo = {
  /** The pixel_id used in promoted_object for conversion optimization / CAPI. */
  id: string;
  name: string | null;
  lastFiredTime: string | null;
  creationTime: string | null;
  isUnavailable: boolean;
  /** ADVERTISING_AND_ANALYTICS | ANALYTICS_ONLY */
  dataUseSetting: string | null;
};

export function mapPixel(raw: RawPixel): PixelInfo {
  return {
    id: raw.id,
    name: raw.name ?? null,
    lastFiredTime: raw.last_fired_time ?? null,
    creationTime: raw.creation_time ?? null,
    isUnavailable: raw.is_unavailable === true,
    dataUseSetting: raw.data_use_setting ?? null,
  };
}

export async function getAdAccountPixelsList(
  ctx: MetaCtx,
): Promise<{ pixels: PixelInfo[]; truncated: boolean }> {
  const res = await callMeta<{ data?: RawPixel[]; paging?: GraphPaging }>({
    domain: "FACEBOOK",
    method: "GET",
    path: `${formatAccountId(ctx.adAccountId)}/adspixels`,
    params: `fields=${PIXEL_FIELDS}&limit=100`,
    accessToken: ctx.accessToken,
  });
  return {
    pixels: (res.data ?? []).map(mapPixel),
    truncated: Boolean(res.paging?.next),
  };
}
