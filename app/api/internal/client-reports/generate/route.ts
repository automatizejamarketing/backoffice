import { NextResponse } from "next/server";
import { buildReportSnapshot } from "@/lib/client-reports/build-snapshot";
import { isClientReportsEnabled } from "@/lib/client-reports/config";
import { inclusiveDays } from "@/lib/client-reports/dates";
import { assertClientReportsAuthorized } from "@/lib/client-reports/internal-auth";

export const maxDuration = 300;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const auth = assertClientReportsAuthorized(request);
  if (!auth.ok) return auth.response;
  if (!isClientReportsEnabled()) {
    return NextResponse.json({ error: "Relatórios estão desativados." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    userId?: string;
    start?: string;
    end?: string;
    campaignId?: string | null;
  } | null;
  const userId = body?.userId?.trim() ?? "";
  const start = body?.start?.trim() ?? "";
  const end = body?.end?.trim() ?? "";
  const campaignId = body?.campaignId?.trim() || null;

  if (!UUID.test(userId) || !DATE_ONLY.test(start) || !DATE_ONLY.test(end)) {
    return NextResponse.json({ error: "Dados do relatório inválidos." }, { status: 400 });
  }
  const windowDays = inclusiveDays(start, end);
  const today = new Date().toISOString().slice(0, 10);
  if (windowDays < 1 || windowDays > 366 || end > today) {
    return NextResponse.json(
      { error: "Escolha um período válido de até 366 dias, sem datas futuras." },
      { status: 400 },
    );
  }

  try {
    const snapshot = await buildReportSnapshot({
      userId,
      periodType: campaignId ? "campaign" : "custom",
      periodStart: start,
      periodEnd: end,
      campaignId,
      generatedBy: "user",
    });
    return NextResponse.json({ snapshotId: snapshot.snapshotId });
  } catch (error) {
    console.error("[client-reports-generate] failed", error);
    return NextResponse.json(
      { error: "Não foi possível gerar o relatório agora. Tente novamente." },
      { status: 500 },
    );
  }
}
