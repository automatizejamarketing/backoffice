/**
 * Adaptador do serviço da Biblioteca de mídias para o R2 de mídia.
 * Espelhado no backoffice — os dois `lib/storage/media-r2.ts` exportam estes
 * mesmos nomes (Tarefa 3 do plano 2026-10-13).
 */
import type { MediaLibraryStorage } from "@/lib/media-library/service";
import {
  MediaObjectNotFoundError,
  createMediaDownloadUrl,
  createMediaUploadUrl,
  deleteMediaObjectKeysReportingErrors,
  getMediaPublicUrl,
  headMediaObject,
  listMediaObjectKeys,
  mediaUrlToKey,
} from "@/lib/storage/media-r2";

/** Host dos uploads anteriores ao R2 que ainda estão gravados em `blob_uploads`. */
const LEGACY_VERCEL_BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";
const VERCEL_BLOB_DELETE_BATCH = 100;

type DeleteResult = { deletedUrls: string[]; failed: { url: string; message: string }[] };

function isVercelBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(LEGACY_VERCEL_BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
}

/**
 * Separa as URLs pelo host. `vercelBlob` = legado do Vercel Blob (apagado pela API do Blob);
 * `foreign` = todas as outras, inclusive as do R2 de mídia (essas são resolvidas pela chave).
 * Pura: sem rede e sem env.
 */
export function classifyLegacyMediaUrls(urls: string[]): { vercelBlob: string[]; foreign: string[] } {
  const vercelBlob: string[] = [];
  const foreign: string[] = [];
  for (const url of urls) {
    if (isVercelBlobUrl(url)) vercelBlob.push(url);
    else foreign.push(url);
  }
  return { vercelBlob, foreign };
}

/**
 * Apaga de verdade no Vercel Blob. Sem token ou com erro, a URL vai para `failed`: a linha
 * continua viva e a próxima rodada tenta de novo. Nunca se diz "apagada" sem apagar.
 */
async function deleteVercelBlobUrls(urls: string[]): Promise<DeleteResult> {
  const result: DeleteResult = { deletedUrls: [], failed: [] };
  if (urls.length === 0) return result;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return { deletedUrls: [], failed: urls.map((url) => ({ url, message: "blob_token_missing" })) };
  }
  for (let start = 0; start < urls.length; start += VERCEL_BLOB_DELETE_BATCH) {
    const batch = urls.slice(start, start + VERCEL_BLOB_DELETE_BATCH);
    try {
      const { del } = await import("@vercel/blob");
      await del(batch, { token });
      result.deletedUrls.push(...batch);
    } catch (error) {
      console.error("[media-library] falha ao apagar blob legado", { count: batch.length, error });
      result.failed.push(...batch.map((url) => ({ url, message: "legacy_blob_delete_failed" })));
    }
  }
  return result;
}

export const mediaLibraryStorage: MediaLibraryStorage = {
  createUploadUrl: (input) => createMediaUploadUrl(input),
  publicUrlForKey: (key) => getMediaPublicUrl(key),
  async head(url) {
    try {
      const head = await headMediaObject(url);
      return { size: head.size, contentType: head.contentType };
    } catch (error) {
      if (error instanceof MediaObjectNotFoundError) return null;
      throw error;
    }
  },
  async deleteUrls(urls) {
    const { vercelBlob, foreign } = classifyLegacyMediaUrls(urls);
    const legacy = await deleteVercelBlobUrls(vercelBlob);
    const keyed = foreign.map((url) => ({ url, key: mediaUrlToKey(url) }));
    // Sem chave R2 e fora do Vercel Blob: não é mídia desta biblioteca, não há o que apagar.
    const notOurs = keyed.filter((entry) => !entry.key).map((entry) => entry.url);
    const withKey = keyed.filter((entry): entry is { url: string; key: string } => Boolean(entry.key));
    const result = await deleteMediaObjectKeysReportingErrors(withKey.map((entry) => entry.key));
    const failedByKey = new Map(result.failed.map((entry) => [entry.key, entry.message]));
    return {
      deletedUrls: [
        ...legacy.deletedUrls,
        ...notOurs,
        ...withKey.filter((entry) => !failedByKey.has(entry.key)).map((entry) => entry.url),
      ],
      failed: [
        ...legacy.failed,
        ...withKey
          .filter((entry) => failedByKey.has(entry.key))
          .map((entry) => ({ url: entry.url, message: failedByKey.get(entry.key) ?? "delete_failed" })),
      ],
    };
  },
  async createDownloadUrl({ url, filename, contentType }) {
    const key = mediaUrlToKey(url);
    if (!key) return url;
    return createMediaDownloadUrl({ objectKey: key, filename, contentType });
  },
};

export function listMediaLibraryObjectKeys(prefix: string): Promise<string[]> {
  return listMediaObjectKeys(prefix);
}

export function deleteMediaLibraryObjectKeys(keys: string[]) {
  return deleteMediaObjectKeysReportingErrors(keys);
}
