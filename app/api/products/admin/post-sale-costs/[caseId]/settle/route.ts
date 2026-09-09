import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { confirmProductPostSaleCostSettlement } from "@/lib/products/post-sale-costs";

const requestSchema = z.object({
  proofUrl: z.string().trim().url().max(2_000),
  proofKey: z.string().trim().min(1).max(255),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Comprovante inválido." }, { status: 400 });
  const { caseId } = await context.params;
  try {
    const result = await confirmProductPostSaleCostSettlement({
      caseId,
      operatorEmail: authz.actor.email,
      proofUrl: parsed.data.proofUrl,
      proofKey: parsed.data.proofKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "post_sale_cost_settlement_failed";
    return NextResponse.json({ error: message }, { status: message === "post_sale_cost_case_not_found" ? 404 : 422 });
  }
}
