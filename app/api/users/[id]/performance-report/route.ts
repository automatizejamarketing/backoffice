import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  buildClientPerformanceReport,
  PerformanceReportError,
} from "@/lib/performance-report";
import type { ClientPerformanceReportV1 } from "@/lib/performance-report/types";

export const maxDuration = 60;

function readFlag(value: string | null): boolean {
  return value === "1" || value === "true";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<
  NextResponse<ClientPerformanceReportV1 | { error: string }>
> {
  const { id } = await params;
  const authz = await requireMarketingUserAccessResponse(id, "marketing:read");
  if (!authz.ok) return authz.response;

  const url = new URL(request.url);
  try {
    const report = await buildClientPerformanceReport({
      userId: id,
      accountId: url.searchParams.get("accountId") ?? undefined,
      campaignId: url.searchParams.get("campaignId") ?? undefined,
      datePreset: url.searchParams.get("datePreset") ?? undefined,
      since: url.searchParams.get("since") ?? undefined,
      until: url.searchParams.get("until") ?? undefined,
      includeCreatives: readFlag(url.searchParams.get("includeCreatives")),
    });
    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof PerformanceReportError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[performance-report] user report failed", error);
    return NextResponse.json(
      { error: "Falha ao montar o relatório de performance." },
      { status: 500 },
    );
  }
}
