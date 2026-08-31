import { NextResponse } from "next/server";

import {
  CreativeAnalysisRequestError,
  parseCreativeAnalysisRequest,
  summarizeCreativeAnalyses,
} from "@/lib/creative-analysis/playground";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { listLatestCreativeDiagnoses } from "@/lib/db/creative-analysis-queries";
import { resolveFrontendAppUrl } from "@/lib/env/frontend-app-url";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_RECORD_LIMIT = 60;

function recordLimit(request: Request): number {
  const value = Number.parseInt(
    new URL(request.url).searchParams.get("limit") ?? "",
    10,
  );
  return Number.isFinite(value)
    ? Math.max(1, Math.min(100, value))
    : DEFAULT_RECORD_LIMIT;
}

export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse(
    "creative-analysis:manage",
  );
  if (!authz.ok) return authz.response;

  try {
    const result = summarizeCreativeAnalyses(
      await listLatestCreativeDiagnoses(recordLimit(request)),
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(
      "[creative-analysis-playground] failed to list records",
      error,
    );
    return NextResponse.json(
      { error: "Não foi possível carregar os diagnósticos." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse(
    "creative-analysis:manage",
  );
  if (!authz.ok) return authz.response;

  try {
    const input = parseCreativeAnalysisRequest(await request.json());
    const secret = process.env.FRONTEND_CRON_SECRET ?? process.env.CRON_SECRET;
    if (!secret) {
      console.error(
        "[creative-analysis-playground] frontend cron secret is not configured",
      );
      return NextResponse.json(
        { error: "A integração segura com o frontend não está configurada." },
        { status: 503 },
      );
    }

    const endpoint = new URL(
      "/api/cron-job/creative-analysis/playground",
      resolveFrontendAppUrl(),
    );
    let upstream: Response;
    try {
      upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
        cache: "no-store",
        signal: AbortSignal.timeout(55_000),
      });
    } catch (error) {
      console.error(
        "[creative-analysis-playground] frontend request failed",
        error,
      );
      return NextResponse.json(
        { error: "O frontend não respondeu à solicitação." },
        { status: 502 },
      );
    }

    if (!upstream.ok) {
      console.error(
        "[creative-analysis-playground] frontend rejected request",
        upstream.status,
      );
      return NextResponse.json(
        {
          error:
            upstream.status === 403
              ? "O playground está bloqueado pelo endpoint do frontend neste ambiente."
              : "O endpoint do frontend recusou a solicitação.",
          upstreamStatus: upstream.status,
        },
        {
          status:
            upstream.status >= 400 && upstream.status < 500
              ? upstream.status
              : 502,
        },
      );
    }

    const result: unknown = await upstream.json();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (
      error instanceof CreativeAnalysisRequestError ||
      error instanceof SyntaxError
    ) {
      return NextResponse.json(
        {
          error:
            error instanceof CreativeAnalysisRequestError
              ? error.message
              : "Corpo JSON inválido.",
        },
        { status: 400 },
      );
    }
    console.error("[creative-analysis-playground] unexpected failure", error);
    return NextResponse.json(
      { error: "Não foi possível processar a solicitação." },
      { status: 500 },
    );
  }
}
