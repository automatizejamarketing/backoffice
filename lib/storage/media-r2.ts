// Sem `import "server-only"`: o bundler do eve avalia os módulos do agente
// (agent/channels/whatsapp → whatsapp-media → este arquivo) e rejeita o guard.
// O módulo continua sendo de servidor por uso — não importar em componentes client.
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { stripInvisibleFormatChars } from "@/lib/media-library/policy";

/**
 * Armazenamento de mídia (imagens/vídeos de posts, criativos, uploads de
 * dispositivo) no Cloudflare R2 — substitui o Vercel Blob (v2, pós-incidente).
 *
 * Objetos vivem sob o prefixo `media/` num bucket DEDICADO de mídia
 * (MEDIA_R2_BUCKET — nunca o bucket de product assets, que guarda PDFs pagos)
 * e são servidos DIRETO pelo custom domain do R2 (MEDIA_PUBLIC_BASE_URL, ex.
 * https://media.automatizemarketing.com): CDN da Cloudflare na frente, Range/206
 * nativo para vídeo e zero passagem pela função. As URLs são estáveis (vão para
 * o banco e para a Meta) e carregam sufixo aleatório não-adivinhável — o mesmo
 * modelo de acesso das URLs públicas do Blob que substituem.
 */

const MEDIA_KEY_PREFIX = "media/";

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
  // Sem fallback para PRODUCT_ASSETS_R2_BUCKET: mídia nunca deve cair no
  // bucket de product assets (PDFs pagos). Env ausente → falha alta e clara.
  const bucket = env.MEDIA_R2_BUCKET;
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
    bucket: process.env.MEDIA_R2_BUCKET,
    accessKeyId:
      process.env.MEDIA_R2_ACCESS_KEY_ID ??
      process.env.PRODUCT_ASSETS_R2_ACCESS_KEY_ID,
    secretAccessKey:
      process.env.MEDIA_R2_SECRET_ACCESS_KEY ??
      process.env.PRODUCT_ASSETS_R2_SECRET_ACCESS_KEY,
  } as MediaR2Config;
}

/**
 * Endpoint do S3 da Cloudflare. `MEDIA_R2_ENDPOINT` existe só para verificação
 * local (S3 compatível, ex. LocalStack) e liga path-style; ausente = R2 real.
 */
export function resolveMediaR2ClientOptions(
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): { endpoint: string; forcePathStyle: boolean } {
  const override = env.MEDIA_R2_ENDPOINT?.trim();
  if (override) return { endpoint: override, forcePathStyle: true };
  return {
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: false,
  };
}

function getClient(config: MediaR2Config) {
  const { endpoint, forcePathStyle } = resolveMediaR2ClientOptions(config.accountId);
  client ??= new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle,
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
  const base = process.env.MEDIA_PUBLIC_BASE_URL;
  if (!base) throw new Error(MEDIA_R2_NOT_CONFIGURED_MESSAGE);
  const key = objectKey.startsWith(MEDIA_KEY_PREFIX)
    ? objectKey
    : `${MEDIA_KEY_PREFIX}${objectKey}`;
  // Percent-encoding por segmento: nomes de arquivo com espaço/acentos viram
  // URLs válidas (o fetcher da Meta rejeita URL crua com espaço; erro 389)
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${base.replace(/\/$/, "")}/${encoded}`;
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
  // v2: https://media.<dominio>/media/<pathname> → chave é o próprio path
  // v1 (legado curto): /api/media/<pathname> → chave é media/<pathname>
  let key: string;
  if (pathname.startsWith(`/${MEDIA_KEY_PREFIX}`)) {
    key = decodeURIComponent(pathname.slice(1));
  } else if (pathname.startsWith("/api/media/")) {
    key = `${MEDIA_KEY_PREFIX}${decodeURIComponent(pathname.slice("/api/media/".length))}`;
  } else {
    return null;
  }
  if (key === MEDIA_KEY_PREFIX || key.includes("..")) return null;
  return key;
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

function isLegacyBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/**
 * Equivalente ao `del()` do @vercel/blob — híbrido durante a transição:
 * URLs do R2 apagam no R2; URLs legadas `*.blob.vercel-storage.com` apagam no
 * Vercel Blob (se o token ainda existir), para excluir mídia antiga sem deixar
 * lixo no store. Falha no caminho legado não derruba a operação.
 */
export async function delMediaObjects(urls: string | string[]): Promise<void> {
  const list = Array.isArray(urls) ? urls : [urls];

  const legacy = list.filter(isLegacyBlobUrl);
  if (legacy.length > 0 && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { del } = await import("@vercel/blob");
      await del(legacy);
    } catch (error) {
      console.warn("[media-r2] falha ao apagar blobs legados (seguindo):", error);
    }
  }

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
    } catch (error) {
      if (isNotFoundError(error)) throw new MediaObjectNotFoundError(key);
      throw error;
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
 * Distingue "objeto não existe" (404 do R2) de falha de acesso/rede
 * (credencial inválida, bucket errado, R2 fora do ar). Sem isso, um problema
 * de credencial se disfarçaria de 404 e passaria despercebido em produção.
 */
function isNotFoundError(error: unknown): boolean {
  const err = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    err?.name === "NoSuchKey" ||
    err?.name === "NotFound" ||
    err?.Code === "NoSuchKey" ||
    err?.$metadata?.httpStatusCode === 404
  );
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
    } catch (error) {
      if (isNotFoundError(error)) throw new MediaObjectNotFoundError(key);
      throw error;
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

function toMediaKey(objectKey: string): string {
  return objectKey.startsWith(MEDIA_KEY_PREFIX) ? objectKey : `${MEDIA_KEY_PREFIX}${objectKey}`;
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `Content-Disposition` de download com nome original (RFC 6266/5987). */
export function buildAttachmentContentDisposition(filename: string): string {
  // Defesa em profundidade: controles bidi não entram nem no fallback nem no filename*.
  const original = stripInvisibleFormatChars(filename).trim() || "midia";
  const fallback =
    original
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_")
      .trim() || "midia";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(original)}`;
}

/**
 * URL assinada (GET) que baixa o objeto com o nome original — o navegador não
 * navega, só baixa. Sem R2 no dev local, devolve a URL pública.
 */
export async function createMediaDownloadUrl(input: {
  objectKey: string;
  filename: string;
  contentType: string | null;
  expiresInSeconds?: number;
}): Promise<string> {
  const key = toMediaKey(input.objectKey);
  if (key.includes("..")) throw new Error(`invalid_media_key: ${input.objectKey}`);
  if (isMediaR2Configured()) {
    const config = getConfig();
    return getSignedUrl(
      getClient(config),
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ResponseContentDisposition: buildAttachmentContentDisposition(input.filename),
        ...(input.contentType ? { ResponseContentType: input.contentType } : {}),
      }),
      { expiresIn: input.expiresInSeconds ?? 300 },
    );
  }
  if (isMediaDevLocalStorageEnabled()) return getMediaPublicUrl(key);
  throw new Error(MEDIA_R2_NOT_CONFIGURED_MESSAGE);
}

/**
 * Como `delMediaObjectKeys`, mas devolve o que falhou chave a chave:
 * `DeleteObjects` reporta erros por chave em `Errors` SEM lançar — ignorar isso
 * marcava como apagado o que continuava no bucket. Chave ausente não é erro.
 * Chave inválida (`..` ou só o prefixo) não é apagada e volta em `failed`.
 */
export async function deleteMediaObjectKeysReportingErrors(
  objectKeys: string[],
): Promise<{ deletedKeys: string[]; failed: { key: string; message: string }[] }> {
  const { keys, invalid } = splitMediaDeleteKeys(objectKeys);
  if (keys.length === 0) return { deletedKeys: [], failed: invalid };

  if (isMediaR2Configured()) {
    const config = getConfig();
    const result = await deleteKeysInBatches(keys, (batch) =>
      getClient(config).send(
        new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      ),
    );
    return { deletedKeys: result.deletedKeys, failed: [...invalid, ...result.failed] };
  }

  if (isMediaDevLocalStorageEnabled()) {
    for (const key of keys) {
      for (const root of getDevLocalStorageRoots()) {
        const filePath = getLocalMediaPath(root, key);
        await rm(filePath, { force: true });
        await rm(`${filePath}.meta.json`, { force: true });
      }
    }
    return { deletedKeys: keys, failed: invalid };
  }

  throw new Error(MEDIA_R2_NOT_CONFIGURED_MESSAGE);
}

/**
 * Deduplica as chaves de exclusão e separa as inválidas (`..` ou só o prefixo),
 * que vão para `invalid` com `invalid_media_key` em vez de sumirem das listas.
 */
export function splitMediaDeleteKeys(objectKeys: string[]): {
  keys: string[];
  invalid: { key: string; message: string }[];
} {
  const keys = new Set<string>();
  const invalid = new Set<string>();
  for (const objectKey of objectKeys) {
    const key = toMediaKey(objectKey);
    if (key === MEDIA_KEY_PREFIX || key.includes("..")) invalid.add(key);
    else keys.add(key);
  }
  return {
    keys: [...keys],
    invalid: [...invalid].map((key) => ({ key, message: "invalid_media_key" })),
  };
}

/**
 * Núcleo de `deleteMediaObjectKeysReportingErrors` sem S3, em lotes de 1000.
 * Erro com Key vai para `failed`; erro sem Key não pode ser atribuído a uma
 * chave, então o lote inteiro falha; exceção do lote também falha o lote.
 */
export async function deleteKeysInBatches(
  keys: string[],
  sendBatch: (batch: string[]) => Promise<{
    Errors?: { Key?: string; Code?: string; Message?: string }[];
  }>,
): Promise<{ deletedKeys: string[]; failed: { key: string; message: string }[] }> {
  const failedByKey = new Map<string, string>();
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    try {
      const result = await sendBatch(batch);
      for (const error of result.Errors ?? []) {
        const message = error.Message ?? error.Code ?? "delete_failed";
        if (error.Key) {
          failedByKey.set(error.Key, message);
        } else {
          for (const key of batch) failedByKey.set(key, message);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "delete_failed";
      for (const key of batch) failedByKey.set(key, message);
    }
  }
  return {
    deletedKeys: keys.filter((key) => !failedByKey.has(key)),
    failed: [...failedByKey].map(([key, message]) => ({ key, message })),
  };
}

/**
 * Junta as chaves de todas as páginas do ListObjectsV2, seguindo
 * `NextContinuationToken` enquanto `IsTruncated`.
 */
export async function collectListedKeys(
  fetchPage: (token: string | undefined) => Promise<{
    Contents?: { Key?: string }[];
    IsTruncated?: boolean;
    NextContinuationToken?: string;
  }>,
): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await fetchPage(continuationToken);
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

/**
 * Prefixo de listagem com `media/` e `/` final. Sem a barra, `media/library/u1`
 * casaria `media/library/u10/...` no R2 e geraria `...u1foo.png` no dev local.
 */
export function normalizeListPrefix(prefix: string): string {
  const normalized = toMediaKey(prefix);
  if (normalized.includes("..") || normalized === MEDIA_KEY_PREFIX) {
    throw new Error(`invalid_media_prefix: ${prefix}`);
  }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

/** Todas as chaves sob um prefixo (`media/...`), paginando o ListObjectsV2. */
export async function listMediaObjectKeys(prefix: string): Promise<string[]> {
  const normalizedPrefix = normalizeListPrefix(prefix);
  if (isMediaR2Configured()) {
    const config = getConfig();
    return collectListedKeys((continuationToken) =>
      getClient(config).send(
        new ListObjectsV2Command({
          Bucket: config.bucket,
          Prefix: normalizedPrefix,
          ContinuationToken: continuationToken,
        }),
      ),
    );
  }
  if (isMediaDevLocalStorageEnabled()) {
    const keys = new Set<string>();
    for (const root of getDevLocalStorageRoots()) {
      const directory = getLocalMediaPath(root, normalizedPrefix);
      const entries = await readdir(directory, { recursive: true }).catch(() => []);
      for (const entry of entries) {
        const relative = String(entry).replace(/\\/g, "/");
        if (!relative.endsWith(".meta.json")) keys.add(`${normalizedPrefix}${relative}`);
      }
    }
    return [...keys];
  }
  throw new Error(MEDIA_R2_NOT_CONFIGURED_MESSAGE);
}
