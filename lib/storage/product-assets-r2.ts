import "server-only";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type ProductAssetsR2Config = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

let client: S3Client | null = null;

function getConfig(): ProductAssetsR2Config {
  const config = {
    accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
    bucket: process.env.PRODUCT_ASSETS_R2_BUCKET,
    accessKeyId: process.env.PRODUCT_ASSETS_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.PRODUCT_ASSETS_R2_SECRET_ACCESS_KEY,
  };
  if (Object.values(config).some((value) => !value)) {
    throw new Error(
      "O armazenamento R2 dos produtos não está configurado neste ambiente.",
    );
  }
  return config as ProductAssetsR2Config;
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
  const config = getConfig();
  return getClient(config).send(
    new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }),
  );
}
