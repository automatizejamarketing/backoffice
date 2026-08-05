import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { videoTemplate } from "@/lib/db/schema";
import { z } from "zod";
import { videoTemplatePreviewService } from "@/lib/creatomate/preview-service";

const templateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  creatomateTemplateId: z.string().min(1),
  videoSourceKey: z.string().min(1),
  thumbnailUrl: z.string().optional().nullable(),
  videoPreviewUrl: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  maxDuration: z.preprocess(
    (value) =>
      value === "" || value === null || value === undefined ? null : value,
    z.number().int().positive().nullable().optional(),
  ),
  status: z.enum(["active", "inactive"]),
});

export async function POST(req: Request) {
  const permission = await requireBackofficePermissionResponse("posts:manage");
  if (!permission.ok) return permission.response;

  try {
    const json = await req.json();
    const data = templateSchema.parse(json);

    if (data.id) {
      // Update
      const [updated] = await db
        .update(videoTemplate)
        .set({
          name: data.name,
          description: data.description,
          creatomateTemplateId: data.creatomateTemplateId,
          videoSourceKey: data.videoSourceKey,
          thumbnailUrl: data.thumbnailUrl,
          videoPreviewUrl: data.videoPreviewUrl,
          category: data.category,
          maxDuration: data.maxDuration,
          status: data.status,
          updatedAt: new Date(),
        })
        .where(eq(videoTemplate.id, data.id))
        .returning();
        
      return NextResponse.json(updated);
    } else {
      // Create
      const [created] = await db
        .insert(videoTemplate)
        .values({
          name: data.name,
          description: data.description,
          creatomateTemplateId: data.creatomateTemplateId,
          videoSourceKey: data.videoSourceKey,
          thumbnailUrl: data.thumbnailUrl,
          videoPreviewUrl: data.videoPreviewUrl,
          category: data.category,
          maxDuration: data.maxDuration,
          status: data.status,
        })
        .returning();

      // Generate preview automatically if not provided
      let previewError: string | undefined;
      if (!data.thumbnailUrl && !data.videoPreviewUrl) {
        const preview = await videoTemplatePreviewService.generatePreview({
          templateId: data.creatomateTemplateId,
          videoSourceKey: data.videoSourceKey,
        });

        if (preview.success && preview.videoPreviewUrl) {
          const [updated] = await db
            .update(videoTemplate)
            .set({
              videoPreviewUrl: preview.videoPreviewUrl,
              thumbnailUrl: preview.thumbnailUrl ?? null,
              updatedAt: new Date(),
            })
            .where(eq(videoTemplate.id, created.id))
            .returning();
          return NextResponse.json({ ...updated, previewError: null });
        } else {
          previewError = preview.error ?? "Failed to generate preview";
        }
      }

      return NextResponse.json({ ...created, previewError });
    }
  } catch (error) {
    console.error("Video Template error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const permission = await requireBackofficePermissionResponse("posts:manage");
  if (!permission.ok) return permission.response;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing ID" }, { status: 400 });
    }

    await db.delete(videoTemplate).where(eq(videoTemplate.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(req: Request) {
  const permission = await requireBackofficePermissionResponse("posts:manage");
  if (!permission.ok) return permission.response;

  try {
    const { searchParams } = new URL(req.url);
    const templateId = searchParams.get("templateId");
    const action = searchParams.get("action");

    if (!templateId) {
      return NextResponse.json({ error: "Missing templateId" }, { status: 400 });
    }

    if (action === "fetch-thumbnail") {
      const thumbnail = await videoTemplatePreviewService.getTemplateThumbnail(templateId);
      if (thumbnail) {
        return NextResponse.json({ thumbnailUrl: thumbnail });
      }
      return NextResponse.json({ thumbnailUrl: null }, { status: 404 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
