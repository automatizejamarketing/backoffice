import { CAMPAIGN_MEDIA_RULES, type CampaignHeaderMedia } from "./whatsapp-campaign-core";

type MediaKind = CampaignHeaderMedia["type"];

/** Google Drive share links open an HTML viewer; the download host serves the file itself. */
export function directDownloadUrl(raw: string): string {
  const url = new URL(raw);
  if (url.hostname === "drive.google.com") {
    const id = url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ?? url.searchParams.get("id");
    if (id) return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  }
  return url.toString();
}

/** Only public https hosts by name: no localhost or IP literals reachable from the server. */
export function assertPublicHttpsUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Informe um link válido para a mídia."); }
  if (url.protocol !== "https:") throw new Error("Use um link https para a mídia.");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local") || /^[\d.]+$/.test(url.hostname) || url.hostname.startsWith("["))
    throw new Error("Use um link público para a mídia.");
  return url;
}

/** Content type from the file signature; hosts like Drive often answer application/octet-stream. */
export function sniffCampaignMedia(bytes: Uint8Array): { kind: MediaKind; contentType: string; extension: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { kind: "image", contentType: "image/jpeg", extension: "jpg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { kind: "image", contentType: "image/png", extension: "png" };
  if (String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") return { kind: "video", contentType: "video/mp4", extension: "mp4" };
  return null;
}

const MAX_BYTES = Math.max(CAMPAIGN_MEDIA_RULES.image.maxBytes, CAMPAIGN_MEDIA_RULES.video.maxBytes);
const megabytes = (bytes: number) => (bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** Downloads a public file (e.g. a Drive link), checks WhatsApp limits and stores it in the media R2. */
export async function importCampaignMedia(
  campaignId: string,
  sourceUrl: string,
  store: (pathname: string, body: Buffer, contentType: string) => Promise<string>,
  request: typeof fetch = fetch,
): Promise<CampaignHeaderMedia> {
  assertPublicHttpsUrl(sourceUrl);
  const response = await request(directDownloadUrl(sourceUrl), { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(45_000) });
  if (!response.ok || !response.body) throw new Error("Não foi possível baixar a mídia. Confira se o link é público.");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new Error(`O arquivo tem ${megabytes(declared)} MB. Limite do WhatsApp: vídeo até 16 MB, imagem até 5 MB. Comprima (vídeo em 720p) e envie de novo.`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error("O arquivo passa de 16 MB, o limite do WhatsApp. Comprima (vídeo em 720p) e envie de novo."); }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks);
  const media = sniffCampaignMedia(body);
  if (!media) throw new Error("Formato não aceito. Use JPG, PNG ou MP4 (H.264). Se for link do Drive, confira se está público.");
  const rule = CAMPAIGN_MEDIA_RULES[media.kind];
  if (body.byteLength > rule.maxBytes) throw new Error(`O arquivo tem ${megabytes(body.byteLength)} MB. Use ${rule.label}.`);
  const url = await store(`whatsapp-campaigns/${campaignId}.${media.extension}`, body, media.contentType);
  return { type: media.kind, url };
}
