import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { getReferralAffiliateCustomers } from "@/lib/referral/customer-queries";

type Context = { params: Promise<{ affiliateId: string }> };

export async function GET(_: Request, context: Context) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;

  // Um id que não é uuid derrubaria a consulta com erro de sintaxe do
  // Postgres; para quem pediu, é só um afiliado que não existe.
  const parsed = z.string().uuid().safeParse((await context.params).affiliateId);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Afiliado não encontrado" },
      { status: 404 },
    );
  }

  try {
    const result = await getReferralAffiliateCustomers(parsed.data);
    if (!result) {
      return NextResponse.json(
        { error: "Afiliado não encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[referral] failed to list affiliate customers", error);
    return NextResponse.json(
      { error: "Erro ao carregar os indicados" },
      { status: 500 },
    );
  }
}
