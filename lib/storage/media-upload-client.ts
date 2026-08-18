/**
 * Upload de mídia do browser direto para o R2 — substitui o `upload()` do
 * @vercel/blob/client. Fluxo: presign no servidor (auth + validação) → PUT
 * direto no R2 → o chamador registra o upload (ex.: registerCampaignBlobUpload
 * ou o confirm do Post do Prato).
 *
 * O retorno imita o PutBlobResult do Blob (`url`, `pathname`, `contentType`)
 * para os call sites continuarem iguais.
 */

export type MediaUploadResult = {
  url: string;
  pathname: string;
  contentType: string;
};

export type MediaUploadOptions = {
  clientPayload?: string;
  contentType?: string;
  endpoint?: string;
  onUploadProgress?: (event: { percentage: number }) => void;
};

function putWithProgress(
  uploadUrl: string,
  file: File | Blob,
  contentType: string,
  onUploadProgress?: (event: { percentage: number }) => void,
): Promise<void> {
  return new Promise((resolvePut, rejectPut) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onUploadProgress) {
        onUploadProgress({
          percentage: Math.round((event.loaded / event.total) * 100),
        });
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolvePut();
      else rejectPut(new Error("Upload failed"));
    };
    xhr.onerror = () => rejectPut(new Error("Upload failed"));
    xhr.send(file);
  });
}

export async function uploadMedia(
  pathname: string,
  file: File | Blob,
  options: MediaUploadOptions = {},
): Promise<MediaUploadResult> {
  const contentType =
    options.contentType ??
    (file instanceof File ? file.type : file.type) ??
    "application/octet-stream";

  const presignResponse = await fetch(options.endpoint ?? "/api/files/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "presign",
      pathname,
      contentType,
      size: file.size,
      clientPayload: options.clientPayload,
    }),
  });

  if (!presignResponse.ok) {
    const data = (await presignResponse.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(data.error ?? "Upload failed");
  }

  const presign = (await presignResponse.json()) as {
    uploadUrl: string;
    pathname: string;
    url: string;
  };

  await putWithProgress(
    presign.uploadUrl,
    file,
    contentType,
    options.onUploadProgress,
  );

  return { url: presign.url, pathname: presign.pathname, contentType };
}
