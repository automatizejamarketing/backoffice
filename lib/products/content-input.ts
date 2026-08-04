import { z } from "zod";

const contentSchema = z.object({
  productId: z.string().uuid(),
  type: z.enum(["video", "pdf", "file", "external_link"]),
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(5_000).optional().nullable(),
  sourceUrl: z.string().trim().max(2_000).optional().nullable(),
  blobPathname: z.string().trim().max(2_000).optional().nullable(),
  videoProvider: z.string().trim().max(30).optional().nullable(),
  filename: z.string().trim().max(255).optional().nullable(),
  mimeType: z.string().trim().max(160).optional().nullable(),
  position: z.number().int().min(0),
  published: z.boolean().optional().default(true),
});

export function parseProductContentInput(input: unknown) {
  const parsed = contentSchema.parse(input);
  const sourceUrl = parsed.sourceUrl || null;
  const blobPathname = parsed.blobPathname || null;
  if (!sourceUrl && !blobPathname) {
    throw new Error("Informe uma URL ou arquivo");
  }
  if (
    parsed.type === "external_link" &&
    !sourceUrl?.startsWith("https://")
  ) {
    throw new Error("Links externos devem usar HTTPS");
  }
  if (
    ["pdf", "file"].includes(parsed.type) &&
    sourceUrl &&
    !sourceUrl.startsWith("https://")
  ) {
    throw new Error("Arquivos externos devem usar HTTPS");
  }

  return {
    ...parsed,
    description: parsed.description || null,
    sourceUrl,
    blobPathname,
    videoProvider: parsed.type === "video" ? parsed.videoProvider || null : null,
    filename: parsed.filename || null,
    mimeType: parsed.mimeType || null,
  };
}
