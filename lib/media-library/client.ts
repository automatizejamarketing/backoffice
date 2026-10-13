/**
 * Biblioteca de mídias — chamadas do navegador (espelhado no backoffice).
 * Upload: presign → PUT direto no R2 com progresso → confirmação no servidor.
 */
import {
  MEDIA_LIBRARY_ERROR_MESSAGES,
  isMediaLibraryClientErrorCode,
  type MediaLibraryClientErrorCode,
} from "@/lib/media-library/policy";
import type { MediaLibraryItem, MediaLibraryListValue } from "@/lib/media-library/service";

export type MediaLibraryListResponse = MediaLibraryListValue & { viewer?: { canWrite: boolean } };

export type MediaLibraryEndpoints = {
  list: string;
  presign: string;
  confirm: string;
  item: (id: string) => string;
  download: (id: string) => string;
};

function endpointsFrom(base: string): MediaLibraryEndpoints {
  return {
    list: base,
    presign: `${base}/uploads`,
    confirm: base,
    item: (id) => `${base}/${encodeURIComponent(id)}`,
    download: (id) => `${base}/${encodeURIComponent(id)}/download`,
  };
}

export function customerMediaLibraryEndpoints(): MediaLibraryEndpoints {
  return endpointsFrom("/api/files/media-library");
}

export function backofficeMediaLibraryEndpoints(userId: string): MediaLibraryEndpoints {
  return endpointsFrom(`/api/users/${encodeURIComponent(userId)}/media-library`);
}

export class MediaLibraryClientError extends Error {
  code: MediaLibraryClientErrorCode;
  constructor(code: MediaLibraryClientErrorCode, message?: string) {
    super(message ?? MEDIA_LIBRARY_ERROR_MESSAGES[code]);
    this.name = "MediaLibraryClientError";
    this.code = code;
  }
}

export function toMediaLibraryClientError(error: unknown): MediaLibraryClientError {
  return error instanceof MediaLibraryClientError ? error : new MediaLibraryClientError("upload_failed");
}

async function errorFromResponse(response: Response): Promise<MediaLibraryClientError> {
  const data = (await response.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
  const code = isMediaLibraryClientErrorCode(data?.code)
    ? data.code
    : response.status >= 500
      ? "storage_unavailable"
      : "upload_failed";
  return new MediaLibraryClientError(code, typeof data?.message === "string" ? data.message : undefined);
}

async function postJson(url: string, body: unknown): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new MediaLibraryClientError("network_error");
  }
}

function putWithProgress(
  uploadUrl: string,
  file: Blob,
  contentType: string,
  onProgress?: (percentage: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new MediaLibraryClientError("upload_failed"));
    };
    xhr.onerror = () => reject(new MediaLibraryClientError("network_error"));
    xhr.send(file);
  });
}

export async function uploadMediaLibraryFile(
  endpoints: MediaLibraryEndpoints,
  file: File,
  onProgress?: (percentage: number) => void,
): Promise<MediaLibraryItem> {
  const presignResponse = await postJson(endpoints.presign, {
    filename: file.name,
    contentType: file.type,
    size: file.size,
  });
  if (!presignResponse.ok) throw await errorFromResponse(presignResponse);
  const presign = (await presignResponse.json()) as { uploadUrl: string; key: string; contentType: string };

  // O PUT precisa do MESMO Content-Type assinado (o servidor normaliza image/jpg → image/jpeg).
  await putWithProgress(presign.uploadUrl, file, presign.contentType, onProgress);

  const confirmResponse = await postJson(endpoints.confirm, { key: presign.key, filename: file.name });
  if (!confirmResponse.ok) throw await errorFromResponse(confirmResponse);
  const data = (await confirmResponse.json()) as { item: MediaLibraryItem };
  onProgress?.(100);
  return data.item;
}

export async function requestMediaLibraryDownload(downloadEndpoint: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(downloadEndpoint, { headers: { Accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new MediaLibraryClientError("network_error");
  }
  if (!response.ok) throw await errorFromResponse(response);
  const data = (await response.json()) as { url?: string };
  if (!data.url) throw new MediaLibraryClientError("storage_unavailable");
  const anchor = document.createElement("a");
  anchor.href = data.url;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function requestMediaLibraryDelete(itemEndpoint: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(itemEndpoint, { method: "DELETE" });
  } catch {
    throw new MediaLibraryClientError("network_error");
  }
  if (!response.ok) throw await errorFromResponse(response);
}
