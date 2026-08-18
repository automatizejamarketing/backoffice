import "server-only";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Armazenamento de mídia (imagens/vídeos de posts, criativos, uploads de
 * dispositivo) no Cloudflare R2 — substitui o Vercel Blob (ADR: migração
 * blob→R2). Objetos vivem sob o prefixo `media/` no bucket de assets.
 *
 * URLs públicas são servidas pelo próprio app em `/api/media/<key>` — estáveis
 * (podem ser persistidas no banco) e acessíveis pela Meta na publicação.
 * A chave carrega sufixo aleatório não-adivinhável, mesmo modelo de acesso
 * das URLs públicas do Vercel Blob.
 */

const MEDIA_KEY_PREFIX = "media/";
const MEDIA_ROUTE_PREFIX = "/api/media/";

type MediaR2Config = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

let client: S3Client | null = null;

export const MEDIA_R2_NOT_CONFIGURED_MESSAGE =
  "O armazenamento R2 de mídia não está configurado neste ambiente.";

export class MediaObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`media_object_not_found: ${key}`);
    this.name = "MediaObjectNotFoundError";
  }
}

export function isMediaR2Configured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const accountId = env.CLOUDFLARE_R2_ACCOUNT_ID;
  const bucket = env.MEDIA_R2_BUCKET ?? env.PRODUCT_ASSETS_R2_BUCKET;
  const accessKeyId =
    env.MEDIA_R2_ACCESS_KEY_ID ?? env.PRODUCT_ASSETS_R2_ACCESS_KEY_ID;
  const secretAccessKey =
    env.MEDIA_R2_SECRET_ACCESS_KEY ?? env.PRODUCT_ASSETS_R2_SECRET_ACCESS_KEY;

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

function getConfig(): MediaR2Config {
  if (!isMediaR2Configured()) {
    throw new Error(MEDIA_R2_NOT_CONFIGURED_MESSAGE);
  }
  return {
    accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
    bucket: process.env.MEDIA_R2_BUCKET ?? process.env.PRODUCT_ASSETS_R2_BUCKET,
    accessKeyId:
      process.env.MEDIA_R2_ACCESS_KEY_ID ??
      process.env.PRODUCT_ASSETS_R2_ACCESS_KEY_ID,
    secretAccessKey:
      process.env.MEDIA_R2_SECRET_ACCESS_KEY ??
      process.env.PRODUCT_ASSETS_R2_SECRET_ACCESS_KEY,
  } as MediaR2Config;
}

function getClient(config: MediaR2Config) {
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

export function isMediaDevLocalStorageEnabled(
  env: NodeJS.ProcessEnv = process.env,
) {
  return env.NODE_ENV === "development" && !isMediaR2Configured(env);
}

function getDevLocalStorageRoots() {
  const roots = [
    join(process.cwd(), ".data/media-r2"),
    join(process.cwd(), "../backoffice/.data/media-r2"),
    join(process.cwd(), "../frontend/.data/media-r2"),
    join(process.cwd(), "../automatize-frontend/.data/media-r2"),
  ];
  return [...new Set(roots.map((root) => resolve(root)))];
}

function getLocalMediaPath(root: string, objectKey: string) {
  return join(root, objectKey.replace(/^media\//, ""));
}

/**
 * URL pública absoluta de uma chave, servida pelo próprio app. Persistível no
 * banco e fetchável pela Meta.
 */
export function getMediaPublicUrl(objectKey: string): string {
  const base =
    process.env.MEDIA_PUBLIC_BASE_URL ??
    process.env.FRONTEND_APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "";
  const key = objectKey.replace(/^media\//, "");
  return `${base.replace(/\/$/, "")}${MEDIA_ROUTE_PREFIX}${key}`;
}

/**
 * Extrai a chave R2 (`media/...`) de uma URL servida pelo app (absoluta ou
 * relativa). Retorna null para URLs que não são deste armazenamento — por
 * exemplo, URLs legadas `*.blob.vercel-storage.com` ainda persistidas no banco.
 */
export function mediaUrlToKey(url: string): string | null {
  let pathname: string;
  try {
    pathname = url.startsWith("/") ? url : new URL(url).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(MEDIA_ROUTE_PREFIX)) return null;
  const key = decodeURIComponent(pathname.slice(MEDIA_ROUTE_PREFIX.length));
  if (!key || key.includes("..")) return null;
  return `${MEDIA_KEY_PREFIX}${key}`;
}

function randomSuffix(): string {
  return randomBytes(8).toString("base64url").replace(/[-_]/g, "").slice(0, 10);
}

function withRandomSuffix(pathname: string): string {
  const dot = pathname.lastIndexOf(".");
  const slash = pathname.lastIndexOf("/");
  if (dot <= slash) return `${pathname}-${randomSuffix()}`;
  return `${pathname.slice(0, dot)}-${randomSuffix()}${pathname.slice(dot)}`;
}

function normalizePathname(pathname: string): string {
  const clean = pathname.replace(/^\/+/, "");
  if (!clean || clean.includes("..")) {
    throw new Error(`invalid_media_pathname: ${pathname}`);
  }
  return clean;
}

export type PutMediaResult = {
  url: string;
  downloadUrl: string;
  pathname: string;
  contentType: string;
};

type PutMediaBody =
  | Buffer
  | Uint8Array
  | ArrayBuffer
  | Blob
  | string
  | ReadableStream<Uint8Array>;

async function toBuffer(body: PutMediaBody): Promise<Buffer> {
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  if (body instanceof ReadableStream) {
    return Buffer.from(await new Response(body).arrayBuffer());
  }
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  return Buffer.from(body);
}

/**
 * Equivalente ao `put()` do @vercel/blob: grava o objeto e retorna a URL
 * pública. `pathname` NÃO deve incluir o prefixo `media/`.
 */
export async function putMediaObject(
  pathname: string,
  body: PutMediaBody,
  options: {
    contentType?: string;
    addRandomSuffix?: boolean;
    cacheControl?: string;
  } = {},
): Promise<PutMediaResult> {
  const finalPathname = options.addRandomSuffix
    ? withRandomSuffix(normalizePathname(pathname))
    : normalizePathname(pathname);
  const objectKey = `${MEDIA_KEY_PREFIX}${finalPathname}`;
  const contentType = options.contentType ?? "application/octet-stream";
  const buffer = await toBuffer(body);

  if (isMediaR2Configured()) {
    const config = getConfig();
    await getClient(config).send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: contentType,
        CacheControl: options.cacheControl ?? "public, max-age=31536000, immutable",
      }),
    );
  } else if (isMediaDevLocalStorageEnabled()) {
    const root = getDevLocalStorageRoots()[0];
    const filePath = getLocalMediaPath(root, objectKey);
    await mkdir(dirname(filePath), { recursive: true });
    await Promise.all([
      writeFile(filePath, buffer),
      writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType }), "utf8"),
    ]);
  } else {
    throw new Error(MEDIA_R2_NOT_CONFIGURED_MESSAGE);
  }

  const url = getMediaPublicUrl(objectKey);
  return { url, downloadUrl: url, pathname: finalPathname, contentType };
}

/**
 * Equivalente ao `del()` do @vercel/blob. Aceita URLs servidas pelo app;
 * URLs de outros domínios (ex.: legadas do Vercel Blob) são ignoradas em
 * silêncio — não há mais o que apagar lá.
 */
export async function delMediaObjects(urls: string | string[]): Promise<void> {
  const list = Array.isArray(urls) ? urls : [urls];
  const keys = list
    .map(mediaUrlToKey)
    .filter((key): key is string => Boolean(key));
  if (keys.length === 0) return;

  if (isMediaR2Configured()) {
    const config = getConfig();
    // DeleteObjects aceita até 1000 chaves por chamada
    for (let i = 0; i < keys.length; i += 1000) {
      await getClient(config).send(
        new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: {
            Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    }
    return;
  }

  if (isMediaDevLocalStorageEnabled()) {
    for (const key of keys) {
      for (const root of getDevLocalStorageRoots()) {
        const filePath = getLocalMediaPath(root, key);
        await rm(filePath, { force: true });
        await rm(`${filePath}.meta.json`, { force: true });
      }
    }
    return;
  }

  throw new Error(MEDIA_R2_NOT_CONFIGURED_MESSAGE);
}

/**
 * Equivalente ao `head()` do @vercel/blob. Lança MediaObjectNotFoundError
 * quando o objeto não existe (inclusive para URLs que não são deste storage).
 */
export async function headMediaObject(url: string): Promise<{
  url: string;
  pathname: string;
  size: number;
  contentType: string;
}> {
  const key = mediaUrlToKey(url);
  if (!key) throw new MediaObjectNotFoundError(url);
  const pathname = key.replace(/^media\//, "");

  if (isMediaR2Configured()) {
    const config = getConfig();
    try {
      const result = await getClient(config).send(
        new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      return {
        url: getMediaPublicUrl(key),
        pathname,
        size: result.ContentLength ?? 0,
        contentType: result.ContentType ?? "application/octet-stream",
      };
    } catch {
      throw new MediaObjectNotFoundError(key);
    }
  }

  if (isMediaDevLocalStorageEnabled()) {
    for (const root of getDevLocalStorageRoots()) {
      const filePath = getLocalMediaPath(root, key);
      if (existsSync(filePath)) {
        const [body, metaRaw] = await Promise.all([
          readFile(filePath),
          readFile(`${filePath}.meta.json`, "utf8").catch(() => null),
        ]);
        let contentType = "application/octet-stream";
        if (metaRaw) {
          try {
            const meta = JSON.parse(metaRaw) as { contentType?: string };
            if (meta.contentType) contentType = meta.contentType;
          } catch {
            // meta inválido → segue com o fallback
          }
        }
        return {
          url: getMediaPublicUrl(key),
          pathname,
          size: body.byteLength,
          contentType,
        };
      }
    }
    throw new MediaObjectNotFoundError(key);
  }

  throw new Error(MEDIA_R2_NOT_CONFIGURED_MESSAGE);
}

/**
 * Stream do objeto para a rota pública `/api/media/[...key]`.
 */
export async function getMediaObject(objectKey: string): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength?: number;
}> {
  const key = objectKey.startsWith(MEDIA_KEY_PREFIX)
    ? objectKey
    : `${MEDIA_KEY_PREFIX}${objectKey}`;

  if (isMediaR2Configured()) {
    const config = getConfig();
    let typed: {
      Body?: { transformToWebStream(): ReadableStream<Uint8Array> };
      ContentType?: string;
      ContentLength?: number;
    };
    try {
      typed = await getClient(config).send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      );
    } catch {
      throw new MediaObjectNotFoundError(key);
    }
    if (!typed.Body) throw new MediaObjectNotFoundError(key);
    return {
      stream: typed.Body.transformToWebStream(),
      contentType: typed.ContentType ?? "application/octet-stream",
      contentLength: typed.ContentLength,
    };
  }

  if (isMediaDevLocalStorageEnabled()) {
    for (const root of getDevLocalStorageRoots()) {
      const filePath = getLocalMediaPath(root, key);
      if (!existsSync(filePath)) continue;
      const [body, metaRaw] = await Promise.all([
        readFile(filePath),
        readFile(`${filePath}.meta.json`, "utf8").catch(() => null),
      ]);
      let contentType = "application/octet-stream";
      if (metaRaw) {
        try {
          const meta = JSON.parse(metaRaw) as { contentType?: string };
          if (meta.contentType) contentType = meta.contentType;
        } catch {
          // meta inválido → segue com o fallback
        }
      }
      return {
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(body);
            controller.close();
          },
        }),
        contentType,
        contentLength: body.byteLength,
      };
    }
    throw new MediaObjectNotFoundError(key);
  }

  throw new Error(MEDIA_R2_NOT_CONFIGURED_MESSAGE);
}

/**
 * Presigned PUT para upload direto do browser (substitui o fluxo
 * handleUpload/upload do @vercel/blob/client). O pathname final (com sufixo
 * aleatório) e a URL pública são decididos aqui, no servidor.
 */
export async function createMediaUploadUrl(input: {
  pathname: string;
  contentType: string;
}): Promise<{ uploadUrl: string; pathname: string; url: string }> {
  const finalPathname = withRandomSuffix(normalizePathname(input.pathname));
  const objectKey = `${MEDIA_KEY_PREFIX}${finalPathname}`;
  const config = getConfig();
  const uploadUrl = await getSignedUrl(
    getClient(config),
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      ContentType: input.contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
    { expiresIn: 10 * 60 },
  );
  return { uploadUrl, pathname: finalPathname, url: getMediaPublicUrl(objectKey) };
}
