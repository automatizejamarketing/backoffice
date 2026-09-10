import { type NextRequest, NextResponse } from "next/server";

import {
  CUSTOMER_FILE_MAX_BYTES,
  CustomerFileImportError,
  type CustomerFileImportTarget,
  customerFileImportHistory,
  formatCustomerFileBytes,
  receiveCustomerFileUpload,
} from "@/lib/customer-file/import-service";
import { customerFileImportDependencies } from "./dependencies";
import { customerFileActor, customerFileErrorResponse } from "./shared";

export const maxDuration = 300;
const OPERATIONS = new Set(["create", "add", "remove", "replace"]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ accountId: string }> }): Promise<NextResponse> {
  try {
    const { accountId } = await params;
    const actor = await customerFileActor(request.nextUrl.searchParams.get("userId"));
    const operations = await customerFileImportHistory({ actor, adAccountId: accountId }, customerFileImportDependencies({ actor, adAccountId: accountId }));
    return NextResponse.json({ operations });
  } catch (error) {
    return customerFileErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ accountId: string }> }): Promise<NextResponse> {
  try {
    const { accountId } = await params;
    const actor = await customerFileActor(request.nextUrl.searchParams.get("userId"));
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof Blob)) throw new CustomerFileImportError("INVALID_FILE", 'Envie o arquivo CSV ou XLSX no campo "file".');
    if (file.size > CUSTOMER_FILE_MAX_BYTES) throw new CustomerFileImportError("FILE_TOO_LARGE", `O arquivo tem ${formatCustomerFileBytes(file.size)} e excede o limite de ${formatCustomerFileBytes(CUSTOMER_FILE_MAX_BYTES)}.`);
    const operation = String(form.get("operation") ?? "");
    if (!OPERATIONS.has(operation)) throw new CustomerFileImportError("INVALID_FILE", "Escolha criar, adicionar, remover ou substituir.");
    const target: CustomerFileImportTarget = {
      adAccountId: accountId,
      operation: operation as CustomerFileImportTarget["operation"],
      ...(form.get("audienceId") ? { audienceId: String(form.get("audienceId")) } : {}),
      ...(form.get("name") ? { name: String(form.get("name")) } : {}),
      ...(form.get("description") ? { description: String(form.get("description")) } : {}),
    };
    const result = await receiveCustomerFileUpload({ actor, target, bytes: new Uint8Array(await file.arrayBuffer()), ...(form.get("worksheet") ? { worksheet: String(form.get("worksheet")) } : {}) }, customerFileImportDependencies({ actor, adAccountId: accountId, audienceId: target.audienceId }));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return customerFileErrorResponse(error);
  }
}
