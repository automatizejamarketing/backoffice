import { NextResponse } from "next/server";
import {
  assertMatReportAuthorized,
  buildClientPerformanceReport,
  buildPerformanceReportUrl,
  PerformanceReportError,
} from "@/lib/performance-report";
import type { ClientPerformanceReportV1 } from "@/lib/performance-report/types";

export const maxDuration = 60;

type MatReportBody = {
  email?: string;
  userId?: string;
  accountId?: string;
  campaignId?: string;
  datePreset?: string;
  since?: string;
  until?: string;
  includeCreatives?: boolean;
};

export type MatPerformanceReportResponse = {
  report: ClientPerformanceReportV1;
  backofficeUrl: string;
};

export async function POST(
  request: Request,
): Promise<
  NextResponse<
    MatPerformanceReportResponse | { error: string; message?: string }
  >
> {
  const authz = assertMatReportAuthorized(request);
  if (!authz.ok) return authz.response;

  let body: MatReportBody;
  try {
    body = (await request.json()) as MatReportBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const report = await buildClientPerformanceReport({
      email: body.email,
      userId: body.userId,
      accountId: body.accountId,
      campaignId: body.campaignId,
      datePreset: body.datePreset,
      since: body.since,
      until: body.until,
      includeCreatives: Boolean(body.includeCreatives),
    });
    return NextResponse.json({
      report,
      backofficeUrl: buildPerformanceReportUrl({
        userId: report.client.userId,
        view: "report",
        accountId: body.accountId,
        campaignId: body.campaignId,
        datePreset: report.accountTotals.period.datePreset,
        since: report.accountTotals.period.since ?? undefined,
        until: report.accountTotals.period.until ?? undefined,
      }),
    });
  } catch (error) {
    if (error instanceof PerformanceReportError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[mat-performance-report] failed", error);
    return NextResponse.json(
      { error: "Falha ao montar o relatório de performance." },
      { status: 500 },
    );
  }
}
