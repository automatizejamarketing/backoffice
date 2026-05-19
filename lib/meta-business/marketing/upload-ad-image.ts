import { graphFacebookBaseUrl, graphApiVersion } from "../constant";
import { throwMetaError } from "./meta-error";

type AdImageEntry = {
  hash: string;
  url?: string;
};

type AdImagesResponse = {
  images?: Record<string, AdImageEntry>;
};

export type UploadAdImageResult = {
  hash: string;
};

function inferExtension(
  contentType: string | null | undefined,
  sourceUrl: string,
): string {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";

  const lower = sourceUrl.split("?")[0].toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".webp")) return "webp";
  if (lower.endsWith(".gif")) return "gif";

  return "png";
}

/**
 * Downloads an image server-side and uploads it to the Meta ad account image
 * library. Meta hosts the image and returns an `image_hash` for ad creatives,
 * avoiding "image couldn't be downloaded" failures (code 100 / subcode
 * 3858258) caused by Meta's crawler being blocked by storage providers
 * (Vercel Blob, S3, etc.) whose firewalls reject the `facebookexternalhit` UA.
 *
 * Reference: https://developers.facebook.com/docs/marketing-api/reference/ad-image/
 */
export async function uploadImageToAdAccount(params: {
  adAccountId: string;
  accessToken: string;
  imageUrl: string;
}): Promise<UploadAdImageResult> {
  const { adAccountId, accessToken, imageUrl } = params;

  console.log("TODELETE - [uploadImageToAdAccount] downloading source", {
    adAccountId,
    imageUrl,
  });

  const sourceResponse = await fetch(imageUrl);
  if (!sourceResponse.ok) {
    console.log("TODELETE - [uploadImageToAdAccount] source download failed", {
      status: sourceResponse.status,
      imageUrl,
    });
    throw new Error(
      `[uploadImageToAdAccount] Failed to download source image (${sourceResponse.status}): ${imageUrl}`,
    );
  }

  const arrayBuffer = await sourceResponse.arrayBuffer();
  const contentType =
    sourceResponse.headers.get("content-type") ?? "image/png";
  const extension = inferExtension(contentType, imageUrl);
  const filename = `image.${extension}`;

  console.log("TODELETE - [uploadImageToAdAccount] source downloaded", {
    contentType,
    extension,
    filename,
    byteLength: arrayBuffer.byteLength,
  });

  const blob = new Blob([arrayBuffer], { type: contentType });

  const formData = new FormData();
  formData.append(filename, blob, filename);
  formData.append("access_token", accessToken);

  const url = `${graphFacebookBaseUrl}/${graphApiVersion}/${adAccountId}/adimages`;

  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

  const data = await response.json();

  console.log("TODELETE - [uploadImageToAdAccount] /adimages response", {
    endpoint: url,
    status: response.status,
    ok: response.ok,
    data,
  });

  if (!response.ok || data.error) {
    console.error("[uploadImageToAdAccount] Error uploading image:", data);
    throwMetaError(data, response.status);
  }

  const adImages = (data as AdImagesResponse).images ?? {};
  const entry = adImages[filename] ?? Object.values(adImages)[0] ?? undefined;

  console.log("TODELETE - [uploadImageToAdAccount] resolved hash", {
    filename,
    hash: entry?.hash,
    availableKeys: Object.keys(adImages),
  });

  if (!entry?.hash) {
    console.error(
      "[uploadImageToAdAccount] Meta response did not include image hash:",
      data,
    );
    throw new Error("Meta /adimages response did not include an image hash");
  }

  return { hash: entry.hash };
}

/**
 * Uploads multiple images in parallel and returns hashes preserving input order.
 */
export async function uploadImagesToAdAccountBatch(params: {
  adAccountId: string;
  accessToken: string;
  imageUrls: string[];
}): Promise<UploadAdImageResult[]> {
  const { adAccountId, accessToken, imageUrls } = params;

  return Promise.all(
    imageUrls.map((imageUrl) =>
      uploadImageToAdAccount({ adAccountId, accessToken, imageUrl }),
    ),
  );
}
