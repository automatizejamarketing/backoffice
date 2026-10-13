/**
 * Biblioteca de mídias — Request → serviço → NextResponse. Espelhado no
 * backoffice: quem chama só resolve QUEM é o dono e o ator (sessão do cliente
 * no app, RBAC do admin no backoffice).
 */
import { NextResponse } from "next/server";
import { MEDIA_LIBRARY_ERROR_MESSAGES, parseMediaLibraryTypeFilter } from "@/lib/media-library/policy";
import {
  confirmMediaLibraryUpload,
  createMediaLibraryUpload,
  deleteMediaLibraryItem,
  getMediaLibraryDownloadUrl,
  listMediaLibrary,
  type MediaLibraryActor,
  type MediaLibraryDeps,
  type MediaLibraryResult,
} from "@/lib/media-library/service";

export type MediaLibraryRequestContext = {
  userId: string;
  actor: MediaLibraryActor;
  viewer?: { canWrite: boolean };
};

function respond<T>(result: MediaLibraryResult<T>, successStatus = 200): NextResponse {
  if (result.ok) return NextResponse.json(result.value, { status: successStatus });
  return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
}

function invalidPayload(): NextResponse {
  return NextResponse.json(
    { error: MEDIA_LIBRARY_ERROR_MESSAGES.invalid_upload, code: "invalid_upload" },
    { status: 400 },
  );
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function mediaLibraryUnauthenticated(): NextResponse {
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

export async function handleMediaLibraryList(
  request: Request,
  ctx: MediaLibraryRequestContext,
  deps: MediaLibraryDeps,
): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const result = await listMediaLibrary(deps, {
    userId: ctx.userId,
    actor: ctx.actor,
    type: parseMediaLibraryTypeFilter(params.get("type")),
    cursor: params.get("cursor"),
  });
  if (!result.ok || !ctx.viewer) return respond(result);
  return NextResponse.json({ ...result.value, viewer: ctx.viewer });
}

export async function handleMediaLibraryPresign(
  request: Request,
  ctx: MediaLibraryRequestContext,
  deps: MediaLibraryDeps,
): Promise<NextResponse> {
  const body = await readJsonObject(request);
  if (
    !body ||
    typeof body.filename !== "string" ||
    typeof body.contentType !== "string" ||
    typeof body.size !== "number"
  ) {
    return invalidPayload();
  }
  return respond(
    await createMediaLibraryUpload(deps, {
      userId: ctx.userId,
      actor: ctx.actor,
      filename: body.filename,
      contentType: body.contentType,
      size: body.size,
    }),
  );
}

export async function handleMediaLibraryConfirm(
  request: Request,
  ctx: MediaLibraryRequestContext,
  deps: MediaLibraryDeps,
): Promise<NextResponse> {
  const body = await readJsonObject(request);
  if (!body || typeof body.key !== "string" || typeof body.filename !== "string") {
    return invalidPayload();
  }
  return respond(
    await confirmMediaLibraryUpload(deps, {
      userId: ctx.userId,
      actor: ctx.actor,
      key: body.key,
      filename: body.filename,
    }),
    201,
  );
}

export async function handleMediaLibraryDelete(
  id: string,
  ctx: MediaLibraryRequestContext,
  deps: MediaLibraryDeps,
): Promise<NextResponse> {
  const result = await deleteMediaLibraryItem(deps, { userId: ctx.userId, actor: ctx.actor, id });
  if (!result.ok) return respond(result);
  return NextResponse.json({ ok: true, ...result.value });
}

export async function handleMediaLibraryDownload(
  request: Request,
  id: string,
  ctx: MediaLibraryRequestContext,
  deps: MediaLibraryDeps,
): Promise<NextResponse> {
  const result = await getMediaLibraryDownloadUrl(deps, { userId: ctx.userId, actor: ctx.actor, id });
  if (!result.ok) return respond(result);
  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
  if (wantsJson) return NextResponse.json({ url: result.value.url });
  return NextResponse.redirect(result.value.url, 302);
}
