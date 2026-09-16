import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { queryReportRetentionCohort } from "@/lib/client-reports/retention";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await queryReportRetentionCohort();
  return NextResponse.json({ rows });
}
