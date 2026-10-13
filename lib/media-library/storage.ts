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
  delMediaObjects,
  deleteMediaObjectKeysReportingErrors,
  getMediaPublicUrl,
  headMediaObject,
  listMediaObjectKeys,
  mediaUrlToKey,
} from "@/lib/storage/media-r2";

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
    const keyed = urls.map((url) => ({ url, key: mediaUrlToKey(url) }));
    // URL sem chave R2 = legado do Vercel Blob (apagado em best-effort) ou host estranho.
    const legacy = keyed.filter((entry) => !entry.key).map((entry) => entry.url);
    if (legacy.length > 0) await delMediaObjects(legacy);
    const withKey = keyed.filter((entry): entry is { url: string; key: string } => Boolean(entry.key));
    const result = await deleteMediaObjectKeysReportingErrors(withKey.map((entry) => entry.key));
    const failedByKey = new Map(result.failed.map((entry) => [entry.key, entry.message]));
    return {
      deletedUrls: [
        ...legacy,
        ...withKey.filter((entry) => !failedByKey.has(entry.key)).map((entry) => entry.url),
      ],
      failed: withKey
        .filter((entry) => failedByKey.has(entry.key))
        .map((entry) => ({ url: entry.url, message: failedByKey.get(entry.key) ?? "delete_failed" })),
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
