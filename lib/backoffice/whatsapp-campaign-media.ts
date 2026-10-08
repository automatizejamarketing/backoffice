import { lookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
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

/** Private, loopback, link-local, CGNAT, multicast and reserved ranges are never fetched. */
export function isPublicAddress(address: string): boolean {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPublicAddress(mapped);
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
  }
  if (isIP(address) === 6) {
    const v6 = address.toLowerCase();
    return !(v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff"));
  }
  return false;
}

/** Resolves once and connects to the checked address, so DNS rebinding cannot swap in an internal IP. */
const publicOnlyAgent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
        if (error) return callback(error, "", 0);
        if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) return callback(new Error("Use um link público para a mídia."), "", 0);
        if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
        callback(null, addresses[0].address, addresses[0].family);
      });
    },
  },
});

/** One hop, no automatic redirects, through the public-only connector. */
export const publicMediaFetch = ((url: string, init?: RequestInit) =>
  undiciFetch(url, { ...(init as object), redirect: "manual", dispatcher: publicOnlyAgent })) as unknown as typeof fetch;

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
  request: typeof fetch = publicMediaFetch,
): Promise<CampaignHeaderMedia> {
  // Every hop is re-validated: a public page must not redirect the server to an internal address.
  let url = assertPublicHttpsUrl(directDownloadUrl(assertPublicHttpsUrl(sourceUrl).toString()));
  const signal = AbortSignal.timeout(45_000);
  let response = await request(url.toString(), { redirect: "manual", signal });
  for (let hop = 0; response.status >= 300 && response.status < 400; hop++) {
    const location = response.headers.get("location");
    if (!location || hop >= 5) throw new Error("O link da mídia redireciona demais. Use um link direto.");
    url = assertPublicHttpsUrl(new URL(location, url).toString());
    response = await request(url.toString(), { redirect: "manual", signal });
  }
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
  const storedUrl = await store(`whatsapp-campaigns/${campaignId}.${media.extension}`, body, media.contentType);
  return { type: media.kind, url: storedUrl };
}
