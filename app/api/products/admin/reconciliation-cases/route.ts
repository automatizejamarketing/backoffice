import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  listProductPaymentAttempts,
} from "@/lib/db/product-queries";

/** Reading the queue only exposes recorded evidence; it settles nothing. */
export async function GET() {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  // Só tentativas inconclusivas: casos de divergência saíram com a automação
  // de pós-venda. Uma divergência hoje é registrada no estado do pagamento e
  // no log, e o acerto com o provedor é feito por gente.
  const attempts = await listProductPaymentAttempts();
  return NextResponse.json({ attempts });
}
