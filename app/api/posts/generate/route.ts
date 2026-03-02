import { gateway } from "@ai-sdk/gateway";
import { put } from "@vercel/blob";
import { generateText } from "ai";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { trackAiUsage } from "@/lib/ai/usage-tracker";
import { AI_MODELS, ASPECT_RATIO_DIMENSIONS } from "@/lib/config/models";
import {
  createBackofficeGeneratedPost,
  updateBackofficeGeneratedPost,
} from "@/lib/db/admin-queries";
import { db } from "@/lib/db/index";
import {
  aiGeneratedText,
  generatedImage,
  referenceImage,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

async function fetchImageAsBase64(imageUrl: string): Promise<string | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer).toString("base64");
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const prompt = formData.get("prompt") as string | null;
    const aspectRatio = (formData.get("aspectRatio") as string) ?? "1:1";
    const targetUserId = formData.get("targetUserId") as string;
    const sourceUserGeneratedImageId =
      (formData.get("sourceUserGeneratedImageId") as string) || undefined;
    const sourceBackofficePostId =
      (formData.get("sourceBackofficePostId") as string) || undefined;
    const notes = (formData.get("notes") as string) || undefined;

    const referenceImageCount = Number.parseInt(
      (formData.get("referenceImageCount") as string) ?? "0",
      10
    );
    const referenceImages: string[] = [];
    const referenceImageUrlsForDb: string[] = [];

    for (let i = 0; i < referenceImageCount; i++) {
      const imageField = formData.get(`referenceImage_${i}`);
      if (imageField instanceof File) {
        const base64 = await fileToBase64(imageField);
        referenceImages.push(base64);
      } else if (typeof imageField === "string" && imageField.trim()) {
        if (imageField.startsWith("http")) {
          referenceImageUrlsForDb.push(imageField);
          const base64 = await fetchImageAsBase64(imageField);
          if (base64) referenceImages.push(base64);
        } else {
          const base64Data = imageField.includes(",")
            ? imageField.split(",")[1]
            : imageField;
          referenceImages.push(base64Data);
        }
      }
    }

    if (!prompt?.trim()) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }
    if (!targetUserId) {
      return NextResponse.json(
        { error: "Target user ID is required" },
        { status: 400 }
      );
    }

    const dims = ASPECT_RATIO_DIMENSIONS[aspectRatio] ?? ASPECT_RATIO_DIMENSIONS["1:1"];
    const { width, height } = dims;

    const backofficePost = await createBackofficeGeneratedPost({
      backofficeUserId: session.user.id,
      targetUserId,
      sourceUserGeneratedImageId,
      sourceBackofficePostId,
      prompt,
      referenceImageUrls: referenceImageUrlsForDb,
      aspectRatio,
      status: "generating",
      notes,
    });

    const [genImageRecord] = await db
      .insert(generatedImage)
      .values({
        userId: session.user.id,
        prompt,
        aspectRatio: aspectRatio as "1:1",
        width,
        height,
        status: "generating",
      })
      .returning();

    const startTime = Date.now();

    try {
      const content: Array<
        { type: "image"; image: string } | { type: "text"; text: string }
      > = [];

      for (const refImg of referenceImages.slice(0, 5)) {
        const base64Data = refImg.startsWith("data:")
          ? refImg.split(",")[1]
          : refImg;
        content.push({ type: "image", image: base64Data });
      }

      const imagePrompt = `Create a high-quality image with the following specifications:

Format: ${aspectRatio} (${width}x${height} pixels)

User Request: ${prompt}

Important guidelines:
- Create a visually striking composition
- Use professional lighting and color grading
- Make the design modern, clean, and engaging
- The image should be eye-catching and high quality
- NEVER include hashtags (#) or @ symbols in the image
- Do NOT add any text that looks like social media tags or handles${referenceImages.length > 0 ? "\n\nReference images have been provided. Use them as inspiration for style, composition, or content as appropriate to the request." : ""}`;

      content.push({ type: "text", text: imagePrompt });

      const result = await generateText({
        model: gateway.languageModel(AI_MODELS.IMAGE_GENERATION),
        providerOptions: {
          google: { responseModalities: ["TEXT", "IMAGE"] },
        },
        messages: [{ role: "user", content }],
      });

      const generationTimeMs = Date.now() - startTime;

      const imageFiles = result.files?.filter((f) =>
        f.mediaType?.startsWith("image/")
      );

      if (!imageFiles || imageFiles.length === 0) {
        await db
          .update(generatedImage)
          .set({ status: "cancelled", errorMessage: "No image generated" })
          .where(eq(generatedImage.id, genImageRecord.id));
        await updateBackofficeGeneratedPost(backofficePost.id, {
          status: "failed",
        });

        return NextResponse.json(
          { error: "No image was generated" },
          { status: 500 }
        );
      }

      const imageFile = imageFiles[0];
      const imageBuffer = Buffer.from(imageFile.uint8Array);
      const timestamp = Date.now();
      const filename = `backoffice/generated/${session.user.id}/${backofficePost.id}/${timestamp}.png`;

      const blob = await put(filename, imageBuffer, {
        access: "public",
        contentType: imageFile.mediaType ?? "image/png",
      });

      await db
        .update(generatedImage)
        .set({
          status: "completed",
          image: blob.url,
          publicImageUrl: blob.url,
        })
        .where(eq(generatedImage.id, genImageRecord.id));

      const usageLog = await trackAiUsage({
        userId: session.user.id,
        modelId: AI_MODELS.IMAGE_GENERATION,
        usage: result.usage,
        providerMetadata: result.providerMetadata,
        durationMs: generationTimeMs,
      });

      if (usageLog?.id) {
        await db
          .update(generatedImage)
          .set({ aiUsageLogId: usageLog.id })
          .where(eq(generatedImage.id, genImageRecord.id));
      }

      // Store reference image URLs
      for (const refUrl of referenceImageUrlsForDb) {
        await db.insert(referenceImage).values({
          imageUrl: refUrl,
          aiGeneratedImageId: genImageRecord.id,
        });
      }

      // Generate caption
      let captionTextId: string | null = null;
      let captionResult: string | null = null;

      try {
        const captionPrompt = `Generate a compelling Instagram caption for this image.
The caption should be engaging, include relevant hashtags, and match the tone of the image.
If there's text in the image, use it as context.
The caption should be in Portuguese (Brazil) by default.
Return ONLY the caption text, without any quotes or preamble.`;

        const captionStartTime = Date.now();

        const captionGen = await generateText({
          model: gateway.languageModel(AI_MODELS.TEXT_GENERATION),
          messages: [
            {
              role: "user",
              content: [
                { type: "image", image: new URL(blob.url) },
                { type: "text", text: captionPrompt },
              ],
            },
          ],
        });

        const captionDurationMs = Date.now() - captionStartTime;
        captionResult = captionGen.text.trim();

        const [captionRecord] = await db
          .insert(aiGeneratedText)
          .values({
            userId: session.user.id,
            prompt: captionPrompt,
            text: captionResult,
            status: "completed",
          })
          .returning();

        captionTextId = captionRecord.id;

        await trackAiUsage({
          userId: session.user.id,
          modelId: AI_MODELS.TEXT_GENERATION,
          usage: captionGen.usage,
          providerMetadata: captionGen.providerMetadata,
          durationMs: captionDurationMs,
        });
      } catch (captionError) {
        console.error("Caption generation error:", captionError);
      }

      await updateBackofficeGeneratedPost(backofficePost.id, {
        generatedImageId: genImageRecord.id,
        captionTextId: captionTextId ?? undefined,
        status: "completed",
      });

      return NextResponse.json(
        {
          id: backofficePost.id,
          imageUrl: blob.url,
          caption: captionResult,
          generatedImageId: genImageRecord.id,
          captionTextId,
        },
        { status: 201 }
      );
    } catch (genError) {
      console.error("Generation error:", genError);
      await db
        .update(generatedImage)
        .set({
          status: "cancelled",
          errorMessage:
            genError instanceof Error ? genError.message : "Generation failed",
        })
        .where(eq(generatedImage.id, genImageRecord.id));
      await updateBackofficeGeneratedPost(backofficePost.id, {
        status: "failed",
      });

      return NextResponse.json(
        {
          error:
            genError instanceof Error
              ? genError.message
              : "Failed to generate",
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed" },
      { status: 500 }
    );
  }
}
