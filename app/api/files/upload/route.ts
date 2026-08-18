import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
  backofficeAuthErrorResponse,
  requireMarketingUserAccess,
} from "@/lib/auth/rbac";
import { db } from "@/lib/db/index";
import { blobUpload } from "@/lib/db/schema";
import { createMediaUploadUrl } from "@/lib/storage/media-r2";

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"];
const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const ACCEPTED_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES];

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_VIDEO_SIZE = 300 * 1024 * 1024;

const CAMPAIGN_MEDIA_SOURCE = "campaign_media";

type UploadTokenPayload = {
  userId?: string;
  source?: string;
};

function parseUploadPayload(
  payload: string | null | undefined,
): UploadTokenPayload {
  if (!payload) return {};
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object") return {};
    const { userId, source } = parsed as Record<string, unknown>;
    return {
      userId: typeof userId === "string" ? userId : undefined,
      source: typeof source === "string" ? source : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Persist a blob_uploads row once, guarded against the double-write that
 * happens when both the (best-effort) Vercel callback and the authenticated
 * client register call land. The selected end-user owns the row (FK to
 * users.id) — backoffice actors are not in the users table.
 */
async function recordBlobUploadOnce(params: {
  userId: string;
  blobUrl: string;
  pathname?: string | null;
  contentType?: string | null;
}): Promise<void> {
  const existing = await db
    .select({ id: blobUpload.id })
    .from(blobUpload)
    .where(
      and(
        eq(blobUpload.blobUrl, params.blobUrl),
        isNull(blobUpload.deletedAt),
      ),
    )
    .limit(1);

  if (existing.length > 0) return;

  await db.insert(blobUpload).values({
    userId: params.userId,
    blobUrl: params.blobUrl,
    pathname: params.pathname ?? null,
    contentType: params.contentType ?? null,
    source: CAMPAIGN_MEDIA_SOURCE,
    updatedAt: new Date(),
  });
}

type RegisterBody = {
  action: "register";
  userId: string;
  blobUrl: string;
  pathname?: string;
  contentType?: string;
  source?: string;
};

function isRegisterBody(body: unknown): body is RegisterBody {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { action?: unknown }).action === "register"
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.json();

  // The browser registers the blob_uploads row after upload() resolves, while
  // it still carries the backoffice session cookie. This avoids depending on
  // Vercel's cookie-less onUploadCompleted callback, which proxy.ts would
  // redirect to /login in production.
  if (isRegisterBody(rawBody)) {
    if (rawBody.source !== CAMPAIGN_MEDIA_SOURCE || !rawBody.blobUrl) {
      return NextResponse.json(
        { error: "Invalid register payload" },
        { status: 400 },
      );
    }
    try {
      await requireMarketingUserAccess(rawBody.userId, "marketing:write");
    } catch (error) {
      return backofficeAuthErrorResponse(error);
    }
    await recordBlobUploadOnce({
      userId: rawBody.userId,
      blobUrl: rawBody.blobUrl,
      pathname: rawBody.pathname,
      contentType: rawBody.contentType,
    });
    return NextResponse.json({ ok: true });
  }

  // Presign de upload direto do browser para o R2 (substitui o protocolo
  // handleUpload do @vercel/blob/client). O registro em blob_uploads continua
  // sendo o register autenticado acima.
  const presign = rawBody as {
    action?: unknown;
    pathname?: unknown;
    contentType?: unknown;
    size?: unknown;
    clientPayload?: unknown;
  };

  if (
    presign?.action !== "presign" ||
    typeof presign.pathname !== "string" ||
    typeof presign.contentType !== "string" ||
    typeof presign.size !== "number"
  ) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const { userId } = parseUploadPayload(
      typeof presign.clientPayload === "string"
        ? presign.clientPayload
        : undefined,
    );

    // userId is attacker-controllable — authorize the selected end-user
    // before issuing an upload URL.
    await requireMarketingUserAccess(userId, "marketing:write");

    if (!ACCEPTED_TYPES.includes(presign.contentType)) {
      return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
    }
    const ext = presign.pathname
      .toLowerCase()
      .slice(presign.pathname.lastIndexOf("."));
    const isVideo = VIDEO_EXTENSIONS.includes(ext);
    const maximumSizeInBytes = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (presign.size <= 0 || presign.size > maximumSizeInBytes) {
      return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
    }

    const presigned = await createMediaUploadUrl({
      pathname: presign.pathname,
      contentType: presign.contentType,
    });
    return NextResponse.json(presigned);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
