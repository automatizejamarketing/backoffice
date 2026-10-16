import "server-only";
import { metaApiCall } from "@/lib/meta-business/api";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";

/**
 * Prévias dos criativos do dossiê, lidas ao vivo na Graph API com o token do
 * cliente. O banco não serve para isso: vídeo só guarda `video_id`, Advantage+
 * guarda a imagem dentro do `asset_feed_spec`, e o `image_url` que existe é URL
 * assinada do fbcdn que expira. O `thumbnail_url` do creative cobre os três.
 */

export type AdPreview = {
  adId: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  videoId: string | null;
  title: string | null;
  body: string | null;
  link: string | null;
  callToAction: string | null;
};

export type AdPreviewFormat = "MOBILE_FEED_STANDARD" | "INSTAGRAM_STANDARD" | "INSTAGRAM_STORY";
export const AD_PREVIEW_FORMATS: AdPreviewFormat[] = ["MOBILE_FEED_STANDARD", "INSTAGRAM_STANDARD", "INSTAGRAM_STORY"];

const AD_ID = /^\d{5,25}$/;
/** Teto do `?ids=` da Meta é 50. */
const CHUNK = 50;
/** As URLs assinadas valem dias; 10 min só poupa a Graph API entre aberturas do dossiê. */
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;

const previewCache = new Map<string, { at: number; value: AdPreview }>();
const frameCache = new Map<string, { at: number; value: string | null }>();

function remember<T>(cache: Map<string, { at: number; value: T }>, key: string, value: T) {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), value });
}

type Creative = {
  thumbnail_url?: string;
  image_url?: string;
  video_id?: string;
  title?: string;
  body?: string;
  call_to_action_type?: string;
  object_story_spec?: {
    link_data?: { message?: string; name?: string; link?: string; picture?: string; call_to_action?: { type?: string } };
    video_data?: { message?: string; title?: string; video_id?: string; image_url?: string; call_to_action?: { type?: string; value?: { link?: string } } };
  };
  asset_feed_spec?: {
    bodies?: Array<{ text?: string }>;
    titles?: Array<{ text?: string }>;
    images?: Array<{ url?: string }>;
    videos?: Array<{ video_id?: string; thumbnail_url?: string }>;
    link_urls?: Array<{ website_url?: string }>;
    call_to_action_types?: string[];
  };
};

const CREATIVE_FIELDS =
  "creative.thumbnail_width(400).thumbnail_height(400){thumbnail_url,image_url,video_id,title,body,call_to_action_type,object_story_spec,asset_feed_spec}";

export function toPreview(adId: string, creative: Creative | undefined): AdPreview {
  const story = creative?.object_story_spec;
  const feed = creative?.asset_feed_spec;
  return {
    adId,
    thumbnailUrl: creative?.thumbnail_url ?? feed?.videos?.[0]?.thumbnail_url ?? null,
    imageUrl: creative?.image_url ?? story?.link_data?.picture ?? feed?.images?.[0]?.url ?? null,
    videoId: creative?.video_id ?? story?.video_data?.video_id ?? feed?.videos?.[0]?.video_id ?? null,
    title: creative?.title ?? story?.link_data?.name ?? story?.video_data?.title ?? feed?.titles?.[0]?.text ?? null,
    body: creative?.body ?? story?.link_data?.message ?? story?.video_data?.message ?? feed?.bodies?.[0]?.text ?? null,
    link: story?.link_data?.link ?? story?.video_data?.call_to_action?.value?.link ?? feed?.link_urls?.[0]?.website_url ?? null,
    callToAction:
      creative?.call_to_action_type ??
      story?.link_data?.call_to_action?.type ??
      story?.video_data?.call_to_action?.type ??
      feed?.call_to_action_types?.[0] ??
      null,
  };
}

export class PreviewError extends Error {}

async function tokenFor(userId: string): Promise<string> {
  const token = await getUserAccessTokenByUserId(userId);
  if (!token.success) throw new PreviewError("O Facebook do cliente está desconectado — sem prévia ao vivo.");
  return token.accessToken;
}

/**
 * Prévia de cada anúncio (miniatura 400×400, texto, link). O token do cliente
 * só enxerga as contas dele, então um id de outro cliente volta vazio.
 */
export async function getAdPreviews(userId: string, adIds: string[]): Promise<Record<string, AdPreview>> {
  const ids = [...new Set(adIds.filter((id) => AD_ID.test(id)))].slice(0, 100);
  const result: Record<string, AdPreview> = {};
  const missing: string[] = [];
  const now = Date.now();
  for (const id of ids) {
    const hit = previewCache.get(`${userId}:${id}`);
    if (hit && now - hit.at < TTL_MS) result[id] = hit.value;
    else missing.push(id);
  }
  if (missing.length === 0) return result;
  const accessToken = await tokenFor(userId);
  const chunks: string[][] = [];
  for (let index = 0; index < missing.length; index += CHUNK) chunks.push(missing.slice(index, index + CHUNK));
  await Promise.all(
    chunks.map(async (chunk) => {
      let nodes: Record<string, { creative?: Creative }> = {};
      try {
        nodes = await metaApiCall<Record<string, { creative?: Creative }>>({
          method: "GET",
          path: "",
          params: `ids=${chunk.join(",")}&fields=${encodeURIComponent(CREATIVE_FIELDS)}`,
          accessToken,
        });
      } catch (error) {
        // Um id apagado derruba o lote inteiro na Meta: lê um a um para salvar o resto.
        if (chunk.length === 1) {
          console.warn("[consultant-workspace previews]", chunk[0], error instanceof Error ? error.message : error);
          return;
        }
        const single = await Promise.all(chunk.map((id) => getAdPreviews(userId, [id]).catch(() => ({}))));
        for (const part of single) Object.assign(result, part);
        return;
      }
      for (const id of chunk) {
        const node = nodes[id];
        if (!node) continue;
        const preview = toPreview(id, node.creative);
        remember(previewCache, `${userId}:${id}`, preview);
        result[id] = preview;
      }
    }),
  );
  return result;
}

/**
 * URL do iframe de prévia da Meta (o anúncio renderizado, com vídeo tocando).
 * Só aceita endereço do próprio Facebook.
 */
export async function getAdPreviewFrame(userId: string, adId: string, format: AdPreviewFormat): Promise<string | null> {
  if (!AD_ID.test(adId) || !AD_PREVIEW_FORMATS.includes(format)) return null;
  const key = `${userId}:${adId}:${format}`;
  const hit = frameCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const accessToken = await tokenFor(userId);
  const response = await metaApiCall<{ data?: Array<{ body?: string }> }>({
    method: "GET",
    path: `${adId}/previews`,
    params: `ad_format=${format}`,
    accessToken,
  });
  const src = frameSrc(response.data?.[0]?.body);
  remember(frameCache, key, src);
  return src;
}

export function frameSrc(html: string | undefined): string | null {
  const raw = html?.match(/src="([^"]+)"/)?.[1];
  if (!raw) return null;
  const src = raw.replace(/&amp;/g, "&");
  try {
    const url = new URL(src);
    return url.protocol === "https:" && /(^|\.)facebook\.com$/.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}
