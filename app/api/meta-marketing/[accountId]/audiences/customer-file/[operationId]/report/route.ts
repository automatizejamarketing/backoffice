import { type NextRequest, NextResponse } from "next/server";

import { customerFileImportReport, CustomerFileImportError, type CustomerFileImportSelection } from "@/lib/customer-file/import-service";
import { customerFileImportDependencies } from "../../dependencies";
import { customerFileActor, customerFileErrorResponse } from "../../shared";

export async function GET(request: NextRequest, { params }: { params: Promise<{ accountId: string; operationId: string }> }): Promise<NextResponse> {
  try {
    const { accountId, operationId } = await params;
    const actor = await customerFileActor(request.nextUrl.searchParams.get("userId"));
    const emailColumn = request.nextUrl.searchParams.get("emailColumn") ?? undefined;
    const phoneColumn = request.nextUrl.searchParams.get("phoneColumn") ?? undefined;
    const worksheet = request.nextUrl.searchParams.get("worksheet") ?? undefined;
    if (!emailColumn && !phoneColumn) throw new CustomerFileImportError("MAPPING_REQUIRED", "Mapeie uma coluna de e-mail ou telefone antes de baixar o relatório.");
    const selection: CustomerFileImportSelection = {
      mapping: { ...(emailColumn ? { emailColumn } : {}), ...(phoneColumn ? { phoneColumn } : {}) },
      referenceCountry: (request.nextUrl.searchParams.get("referenceCountry") ?? "BR") as CustomerFileImportSelection["referenceCountry"],
      ...(worksheet ? { worksheet } : {}),
    };
    const report = await customerFileImportReport({ actor, operationId, selection }, customerFileImportDependencies({ actor, adAccountId: accountId }));
    return new NextResponse(report.csv, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${report.filename}"` } });
  } catch (error) {
    return customerFileErrorResponse(error);
  }
}
