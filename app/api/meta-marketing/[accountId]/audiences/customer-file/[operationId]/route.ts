import { after, type NextRequest, NextResponse } from "next/server";

import {
  CUSTOMER_LIST_SOURCE,
  CustomerFileImportError,
  type CustomerFileImportSelection,
  customerFileImportStatus,
  inspectCustomerFileImport,
  markCustomerFileImportActionRequired,
  prepareCustomerFileImportRun,
  previewCustomerFileImport,
  runCustomerFileImportPlan,
} from "@/lib/customer-file/import-service";
import { customerFileImportDependencies } from "../dependencies";
import { customerFileActor, customerFileErrorResponse } from "../shared";

export const maxDuration = 300;

type Body = {
  action?: "inspect" | "preview" | "start" | "recover";
  emailColumn?: string;
  phoneColumn?: string;
  referenceCountry?: string;
  worksheet?: string;
  audienceId?: string;
  previewToken?: string;
  explicitlySendValidRows?: boolean;
  declarations?: { dataOrigin?: string; termsAccepted?: boolean };
};

function selectionOf(body: Body): CustomerFileImportSelection {
  return {
    mapping: { ...(body.emailColumn ? { emailColumn: body.emailColumn } : {}), ...(body.phoneColumn ? { phoneColumn: body.phoneColumn } : {}) },
    ...(body.referenceCountry ? { referenceCountry: body.referenceCountry as CustomerFileImportSelection["referenceCountry"] } : {}),
    ...(body.worksheet ? { worksheet: body.worksheet } : {}),
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ accountId: string; operationId: string }> }): Promise<NextResponse> {
  try {
    const { accountId, operationId } = await params;
    const actor = await customerFileActor(request.nextUrl.searchParams.get("userId"));
    return NextResponse.json(await customerFileImportStatus({ actor, operationId }, customerFileImportDependencies({ actor, adAccountId: accountId })));
  } catch (error) {
    return customerFileErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ accountId: string; operationId: string }> }): Promise<NextResponse> {
  try {
    const { accountId, operationId } = await params;
    const actor = await customerFileActor(request.nextUrl.searchParams.get("userId"));
    const body = (await request.json().catch(() => ({}))) as Body;
    const deps = customerFileImportDependencies({ actor, adAccountId: accountId, ...(body.audienceId ? { audienceId: body.audienceId } : {}) });
    if (body.action === "inspect") return NextResponse.json(await inspectCustomerFileImport({ actor, operationId, ...(body.worksheet ? { worksheet: body.worksheet } : {}) }, deps));
    if (body.action === "preview") return NextResponse.json(await previewCustomerFileImport({ actor, operationId, selection: selectionOf(body) }, deps));
    if (body.action !== "start" && body.action !== "recover") throw new CustomerFileImportError("INVALID_FILE", "Ação de importação desconhecida.");
    if (!body.previewToken) throw new CustomerFileImportError("STALE_PREVIEW", "Gere a prévia novamente antes de confirmar o envio.");
    const { plan, status } = await prepareCustomerFileImportRun({ actor, operationId, previewToken: body.previewToken, selection: selectionOf(body), explicitlySendValidRows: Boolean(body.explicitlySendValidRows), declarations: { dataOrigin: body.declarations?.dataOrigin as typeof CUSTOMER_LIST_SOURCE, termsAccepted: Boolean(body.declarations?.termsAccepted) }, stage: body.action }, deps);
    after(async () => {
      try {
        await runCustomerFileImportPlan(plan, deps);
      } catch {
        await markCustomerFileImportActionRequired(operationId, deps).catch(() => undefined);
      }
    });
    return NextResponse.json({ ...status, accepted: true }, { status: 202 });
  } catch (error) {
    return customerFileErrorResponse(error);
  }
}
