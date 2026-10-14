import "server-only";

import { assertPublicHttpsUrl, publicMediaFetch } from "@/lib/backoffice/whatsapp-campaign-media";
import { putMediaObject } from "@/lib/storage/media-r2";
import type { MediaRef } from "./core";

/**
 * Copia a arte do ClickUp para o storage do Automatize na hora de agendar: o anexo pode mudar ou
 * expirar até o horário de publicação. Limites do Instagram: imagem até 8 MB; vídeo até 100 MB
 * aqui (o Instagram aceita mais, mas a cópia passa pela memória da função).
 */

const LIMITS = { image: 8 * 1024 * 1024, video: 100 * 1024 * 1024 } as const;
const megabytes = (bytes: number) => (bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export class MediaError extends Error {}

/** Tipo pelos bytes: JPG, PNG, MP4 ou MOV. */
export function sniffPostMedia(bytes: Uint8Array): { kind: MediaRef["kind"]; contentType: string; extension: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { kind: "image", contentType: "image/jpeg", extension: "jpg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { kind: "image", contentType: "image/png", extension: "png" };
  if (String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    return brand === "qt  " ? { kind: "video", contentType: "video/quicktime", extension: "mov" } : { kind: "video", contentType: "video/mp4", extension: "mp4" };
  }
  return null;
}

const isClickupHost = (url: URL) => /(^|\.)clickup(-attachments)?\.com$/.test(url.hostname);

async function download(source: string, token: string, request: typeof fetch): Promise<Buffer> {
  let url = assertPublicHttpsUrl(source);
  const signal = AbortSignal.timeout(90_000);
  // Anexo do ClickUp pode exigir o token; o token só vai para host do próprio ClickUp.
  const headers = (target: URL): HeadersInit => (isClickupHost(target) ? { Authorization: token } : {});
  let response = await request(url.toString(), { redirect: "manual", signal, headers: headers(url) });
  for (let hop = 0; response.status >= 300 && response.status < 400; hop++) {
    const location = response.headers.get("location");
    if (!location || hop >= 5) throw new MediaError("O link da arte redireciona demais.");
    url = assertPublicHttpsUrl(new URL(location, url).toString());
    response = await request(url.toString(), { redirect: "manual", signal, headers: headers(url) });
  }
  if (!response.ok || !response.body) throw new MediaError(`Não foi possível baixar a arte do ClickUp (HTTP ${response.status}).`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > LIMITS.video) throw new MediaError(`A arte tem ${megabytes(declared)} MB; o limite é 100 MB.`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMITS.video) {
      await reader.cancel();
      throw new MediaError("A arte passa de 100 MB.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export type StoredMedia = { url: string; kind: MediaRef["kind"] };

export async function copyTaskMedia(
  input: { agencyId: string; taskId: string; media: MediaRef[]; token: string },
  deps: { request?: typeof fetch; store?: typeof putMediaObject } = {},
): Promise<StoredMedia[]> {
  const request = deps.request ?? publicMediaFetch;
  const store = deps.store ?? putMediaObject;
  const stamp = Date.now();
  const stored: StoredMedia[] = [];
  for (const [index, item] of input.media.entries()) {
    const body = await download(item.url, input.token, request);
    const sniffed = sniffPostMedia(body);
    if (!sniffed) throw new MediaError("Formato da arte não aceito. Use JPG ou PNG (post) e MP4 ou MOV (Reels).");
    if (sniffed.kind !== item.kind) throw new MediaError(item.kind === "image" ? "Um dos arquivos do post não é imagem." : "O arquivo do Reels não é vídeo.");
    if (body.byteLength > LIMITS[sniffed.kind]) {
      throw new MediaError(`${sniffed.kind === "image" ? "A imagem" : "O vídeo"} tem ${megabytes(body.byteLength)} MB; o limite é ${megabytes(LIMITS[sniffed.kind])} MB.`);
    }
    const saved = await store(`clickup/${input.agencyId}/${input.taskId}/${stamp}-${index + 1}.${sniffed.extension}`, body, {
      contentType: sniffed.contentType,
      addRandomSuffix: false,
    });
    stored.push({ url: saved.url, kind: sniffed.kind });
  }
  return stored;
}
