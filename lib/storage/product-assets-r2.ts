import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type ProductAssetsR2Config = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export const PRODUCT_ASSETS_R2_NOT_CONFIGURED_MESSAGE =
  "O armazenamento R2 dos produtos não está configurado neste ambiente. Crie credenciais no Cloudflare R2 e adicione-as em .env.r2.local.";

const DEV_LOCAL_STORAGE_ROOT = join(process.cwd(), ".data/product-assets-r2");

let client: S3Client | null = null;

export function isProductAssetsR2Configured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const accountId = env.CLOUDFLARE_R2_ACCOUNT_ID;
  const bucket = env.PRODUCT_ASSETS_R2_BUCKET;
  const accessKeyId = env.PRODUCT_ASSETS_R2_ACCESS_KEY_ID;
  const secretAccessKey = env.PRODUCT_ASSETS_R2_SECRET_ACCESS_KEY;

  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    return false;
  }

  if (
    accessKeyId === "[SENSITIVE]" ||
    secretAccessKey === "[SENSITIVE]" ||
    accessKeyId.length < 16 ||
    secretAccessKey.length < 16
  ) {
    return false;
  }

  return true;
}

export function isProductAssetsDevLocalStorageEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV === "development" && !isProductAssetsR2Configured(env);
}

function getConfig(): ProductAssetsR2Config {
  if (!isProductAssetsR2Configured()) {
    throw new Error(PRODUCT_ASSETS_R2_NOT_CONFIGURED_MESSAGE);
  }

  return {
    accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID!,
    bucket: process.env.PRODUCT_ASSETS_R2_BUCKET!,
    accessKeyId: process.env.PRODUCT_ASSETS_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.PRODUCT_ASSETS_R2_SECRET_ACCESS_KEY!,
  };
}

function getClient(config: ProductAssetsR2Config) {
  client ??= new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return client;
}

function getLocalAssetPath(objectKey: string) {
  return join(DEV_LOCAL_STORAGE_ROOT, objectKey.replace(/^r2\//, ""));
}

function getLocalAssetMetaPath(objectKey: string) {
  return `${getLocalAssetPath(objectKey)}.meta.json`;
}

function guessContentType(objectKey: string, fallback = "application/octet-stream") {
  const lower = objectKey.toLowerCase();
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".avif")) return "image/avif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".mp4")) return "video/mp4";
  return fallback;
}

async function readLocalProductAsset(objectKey: string) {
  const filePath = getLocalAssetPath(objectKey);
  if (!existsSync(filePath)) {
    throw new Error("product_asset_not_found");
  }

  const [body, head] = await Promise.all([
    readFile(filePath),
    readLocalProductAssetHead(objectKey),
  ]);

  return {
    Body: {
      transformToWebStream() {
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(body);
            controller.close();
          },
        });
      },
    },
    ContentLength: head.ContentLength,
    ContentType: head.ContentType,
  };
}

async function readLocalProductAssetHead(objectKey: string) {
  const filePath = getLocalAssetPath(objectKey);
  if (!existsSync(filePath)) throw new Error("product_asset_not_found");
  const [file, metaRaw] = await Promise.all([
    stat(filePath),
    readFile(getLocalAssetMetaPath(objectKey), "utf8").catch(() => null),
  ]);
  let contentType = guessContentType(objectKey);
  if (metaRaw) {
    try {
      const meta = JSON.parse(metaRaw) as { contentType?: string };
      if (meta.contentType) contentType = meta.contentType;
    } catch {
      // Ignore invalid metadata and fall back to extension guessing.
    }
  }
  return { ContentLength: file.size, ContentType: contentType };
}

async function writeLocalProductAsset(input: {
  objectKey: string;
  contentType: string;
  body: Uint8Array;
}) {
  const filePath = getLocalAssetPath(input.objectKey);
  await mkdir(dirname(filePath), { recursive: true });
  await Promise.all([
    writeFile(filePath, input.body),
    writeFile(
      getLocalAssetMetaPath(input.objectKey),
      JSON.stringify({ contentType: input.contentType }),
      "utf8",
    ),
  ]);
}

export async function createProductAssetUploadUrl(input: {
  objectKey: string;
  contentType: string;
  cacheControl: string;
}) {
  const config = getConfig();
  return getSignedUrl(
    getClient(config),
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
      CacheControl: input.cacheControl,
    }),
    { expiresIn: 5 * 60 },
  );
}

export async function getProductAsset(objectKey: string) {
  if (isProductAssetsR2Configured()) {
    const config = getConfig();
    return getClient(config).send(
      new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    );
  }

  if (isProductAssetsDevLocalStorageEnabled()) {
    return readLocalProductAsset(objectKey);
  }

  throw new Error(PRODUCT_ASSETS_R2_NOT_CONFIGURED_MESSAGE);
}

/** Reads storage metadata without downloading the object body. */
export async function headProductAsset(objectKey: string) {
  if (isProductAssetsR2Configured()) {
    const config = getConfig();
    return getClient(config).send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    );
  }
  if (isProductAssetsDevLocalStorageEnabled()) {
    return readLocalProductAssetHead(objectKey);
  }
  throw new Error(PRODUCT_ASSETS_R2_NOT_CONFIGURED_MESSAGE);
}

/**
 * Materializes only a caller-defined bounded payload. Defence submission uses
 * this after HEAD has confirmed the 10 MiB ceiling, so a forged client size or
 * an unexpectedly large object cannot become an unbounded allocation.
 */
export async function readProductAssetBytes(
  objectKey: string,
  maxBytes: number,
) {
  const head = await headProductAsset(objectKey);
  if (
    typeof head.ContentLength !== "number" ||
    head.ContentLength <= 0 ||
    head.ContentLength > maxBytes
  ) {
    throw new Error("product_asset_size_limit_exceeded");
  }
  const asset = await getProductAsset(objectKey);
  const body = asset.Body as unknown as {
    transformToWebStream?: () => ReadableStream<Uint8Array>;
    transformToByteArray?: () => Promise<Uint8Array>;
  } | undefined;
  if (!body) throw new Error("product_asset_not_found");

  if (body.transformToWebStream) {
    const reader = body.transformToWebStream().getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = next.value;
        total += chunk.byteLength;
        if (total > maxBytes) throw new Error("product_asset_size_limit_exceeded");
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  if (body.transformToByteArray) {
    const bytes = await body.transformToByteArray();
    if (bytes.byteLength > maxBytes) throw new Error("product_asset_size_limit_exceeded");
    return bytes;
  }
  throw new Error("product_asset_body_unreadable");
}

export async function deleteProductAsset(objectKey: string) {
  if (isProductAssetsR2Configured()) {
    const config = getConfig();
    await getClient(config).send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    );
    return;
  }
  if (isProductAssetsDevLocalStorageEnabled()) {
    await Promise.all([
      unlink(getLocalAssetPath(objectKey)).catch(() => undefined),
      unlink(getLocalAssetMetaPath(objectKey)).catch(() => undefined),
    ]);
    return;
  }
  throw new Error(PRODUCT_ASSETS_R2_NOT_CONFIGURED_MESSAGE);
}

export async function putProductAsset(input: {
  objectKey: string;
  contentType: string;
  cacheControl: string;
  body: Uint8Array;
}) {
  if (isProductAssetsR2Configured()) {
    const config = getConfig();
    await getClient(config).send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: input.objectKey,
        Body: input.body,
        ContentType: input.contentType,
        CacheControl: input.cacheControl,
      }),
    );
    return;
  }

  if (isProductAssetsDevLocalStorageEnabled()) {
    await writeLocalProductAsset(input);
    return;
  }

  throw new Error(PRODUCT_ASSETS_R2_NOT_CONFIGURED_MESSAGE);
}

export function isAllowedProductAssetObjectKey(objectKey: string): boolean {
  return (
    (objectKey.startsWith("r2/product-covers/") ||
      objectKey.startsWith("r2/expert-avatars/") ||
      objectKey.startsWith("r2/products/")) &&
    !objectKey.includes("..")
  );
}
