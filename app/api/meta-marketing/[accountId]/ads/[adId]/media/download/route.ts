import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";

const ALLOWED_HOST_SUFFIXES = [
  "fbcdn.net",
  "cdninstagram.com",
  "facebook.com",
  "instagram.com",
];

function isAllowedUpstreamUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    return ALLOWED_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

function sanitizeFilename(input: string): string {
  // The result is placed in `Content-Disposition: filename="..."`, which the
  // Headers constructor encodes as ByteString. Any character > U+00FF (em
  // dash U+2014, ellipsis U+2026, fancy quotes, ...) throws at runtime, so
  // we strip everything outside ASCII after dropping diacritics. Browsers
  // that need the original Unicode read `filename*=UTF-8''` instead.
  const trimmed = input.trim();
  const cleaned = trimmed
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x00-\x7f]/g, "-")
    .replace(/[\\/:*?"<>|\r\n\t]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const safe = cleaned.length > 0 ? cleaned : "midia";
  return safe.slice(0, 120);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; adId: string }> },
): Promise<Response> {
  try {
    await params;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    const kind = searchParams.get("kind");
    const url = searchParams.get("url");
    const filename = searchParams.get("filename");

    if (!userId || !kind || !url || !filename) {
      return NextResponse.json(
        {
          error: "Parâmetros inválidos",
          message: "userId, kind, url e filename são obrigatórios",
          solution: "Reabra o modal de mídia e tente novamente.",
        },
        { status: 400 },
      );
    }

    if (kind !== "image" && kind !== "video") {
      return NextResponse.json(
        {
          error: "Tipo inválido",
          message: "kind deve ser image ou video",
        },
        { status: 400 },
      );
    }

    const authz = await requireMarketingUserAccessResponse(userId);
    if (!authz.ok) return authz.response;

    if (!isAllowedUpstreamUrl(url)) {
      return NextResponse.json(
        {
          error: "Origem não permitida",
          message: "URL de mídia inválida.",
          solution:
            "A URL precisa apontar para a CDN da Meta (fbcdn.net ou cdninstagram.com).",
        },
        { status: 400 },
      );
    }

    const safeFilename = sanitizeFilename(filename);

    const upstream = await fetch(url, { method: "GET" });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        {
          error: "Falha no upstream",
          message: `Não foi possível baixar a mídia (status ${upstream.status}).`,
          solution: "Tente novamente em alguns instantes.",
        },
        { status: 502 },
      );
    }

    const contentType =
      upstream.headers.get("content-type") ??
      (kind === "video" ? "video/mp4" : "application/octet-stream");
    const contentLength = upstream.headers.get("content-length");

    const headers = new Headers({
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
      "Cache-Control": "private, no-store",
    });
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    console.error("Error proxying media download:", error);
    return NextResponse.json(
      {
        error: "Erro interno",
        message: "Ocorreu um erro inesperado ao baixar a mídia.",
        solution: "Tente novamente. Se persistir, contate o suporte.",
      },
      { status: 500 },
    );
  }
}
