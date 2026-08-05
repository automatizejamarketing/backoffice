import { z } from "zod";

const MAX_COVER_SIZE = 10 * 1024 * 1024;
export const MAX_PRODUCT_FILE_SIZE = 50 * 1024 * 1024;

const coverContentTypes = [
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const fileContentTypes = new Set([
  "application/msword",
  "application/octet-stream",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/x-zip-compressed",
  "application/zip",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/plain",
]);

const baseFields = {
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
};

const uploadSchema = z.discriminatedUnion("kind", [
  z.object({
    ...baseFields,
    kind: z.literal("cover"),
    contentType: z.enum(coverContentTypes, {
      errorMap: () => ({ message: "Formato de imagem não permitido" }),
    }),
  }),
  z.object({
    ...baseFields,
    kind: z.literal("content"),
    productId: z
      .string({ required_error: "Produto inválido" })
      .uuid({ message: "Produto inválido" }),
    contentType: z
      .string()
      .trim()
      .refine((value) => fileContentTypes.has(value), {
        message: "Formato de arquivo não permitido",
      }),
  }),
]);

export type ProductUploadInput =
  | {
      kind: "cover";
      filename: string;
      contentType: string;
      size: number;
      productId: null;
    }
  | {
      kind: "content";
      filename: string;
      contentType: string;
      size: number;
      productId: string;
    };

export function parseProductUploadInput(input: unknown): ProductUploadInput {
  const parsed = uploadSchema.parse(input);
  const maximumSize =
    parsed.kind === "cover" ? MAX_COVER_SIZE : MAX_PRODUCT_FILE_SIZE;
  if (parsed.size > maximumSize) {
    throw new Error(
      parsed.kind === "cover"
        ? "A imagem deve ter no máximo 10 MB."
        : "O arquivo deve ter no máximo 50 MB.",
    );
  }

  return parsed.kind === "content"
    ? parsed
    : { ...parsed, productId: null };
}

function safeFilename(filename: string) {
  const lastDot = filename.lastIndexOf(".");
  const rawBase = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const rawExtension = lastDot > 0 ? filename.slice(lastDot + 1) : "";
  const base = rawBase
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "arquivo";
  const extension = rawExtension.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  return extension ? `${base}.${extension}` : base;
}

export function createProductAssetObjectKey(
  input: ProductUploadInput,
  objectId: string,
) {
  const filename = `${objectId}-${safeFilename(input.filename)}`;
  return input.kind === "cover"
    ? `r2/product-covers/${filename}`
    : `r2/products/${input.productId}/${filename}`;
}

export function getProductCoverAssetUrl(objectKey: string) {
  return `/api/products/assets?key=${encodeURIComponent(objectKey)}`;
}
