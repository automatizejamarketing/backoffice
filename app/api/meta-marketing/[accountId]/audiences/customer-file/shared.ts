import { NextResponse } from "next/server";

import { requireMarketingUserAccess } from "@/lib/auth/rbac";
import { customerAudienceImportsEnabled } from "@/lib/meta-business/marketing/audiences/release";
import {
  CustomerFileImportError,
  type CustomerFileImportActor,
} from "@/lib/customer-file/import-service";

export function customerFileErrorResponse(error: unknown): NextResponse {
  if (error instanceof CustomerFileImportError) {
    return NextResponse.json({ error: error.code, message: error.message, ...(error.details ?? {}) }, { status: error.status });
  }
  return NextResponse.json({ error: "CUSTOMER_FILE_IMPORT_FAILED", message: error instanceof Error ? error.message : "Não foi possível concluir a importação." }, { status: 500 });
}

/** The operator is server-side; the browser only supplies the target customer. */
export async function customerFileActor(userId: string | null): Promise<CustomerFileImportActor> {
  if (!userId) throw new CustomerFileImportError("UNAUTHORIZED", "Escolha um cliente para gerenciar listas de clientes.");
  if (!customerAudienceImportsEnabled()) throw new CustomerFileImportError("FEATURE_DISABLED", "A importação de listas de clientes está temporariamente indisponível. Campanhas e histórico permanecem inalterados.");
  try {
    const actor = await requireMarketingUserAccess(userId, "marketing:write");
    return { kind: "backoffice", actorId: actor.id, customerId: userId };
  } catch (error) {
    throw new CustomerFileImportError("UNAUTHORIZED", error instanceof Error ? error.message : "O operador não pode acessar este cliente.");
  }
}
