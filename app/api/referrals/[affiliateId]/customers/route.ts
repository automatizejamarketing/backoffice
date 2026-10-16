import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { getReferralAffiliateCustomers } from "@/lib/referral/customer-queries";
import {
  MANUAL_LINK_ADMIN_ONLY_MESSAGE,
  MANUAL_LINK_AFFILIATE_NOT_FOUND_MESSAGE,
  MANUAL_LINK_INVALID_USER_MESSAGE,
  manualLinkActorAllowed,
  parseManualLinkReason,
} from "@/lib/referral/manual-link";
import { linkReferralCustomerManually } from "@/lib/referral/manual-link-queries";
import { ReferralOperationError } from "@/lib/referral/queries";

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

/**
 * Vínculo manual de Indicado (spec 2026-10-11, R7/R8). Só o cargo admin; a
 * ordem das recusas é a da tabela R7.
 */
export async function POST(request: Request, context: Context) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;
  if (!manualLinkActorAllowed(authz.actor)) {
    return NextResponse.json({ error: MANUAL_LINK_ADMIN_ONLY_MESSAGE }, { status: 403 });
  }

  const affiliateId = z.string().uuid().safeParse((await context.params).affiliateId);
  if (!affiliateId.success) {
    return NextResponse.json({ error: MANUAL_LINK_AFFILIATE_NOT_FOUND_MESSAGE }, { status: 404 });
  }

  // Corpo que não é JSON é um pedido inválido, não um erro do servidor.
  const body = (await request.json().catch(() => null)) as
    | { userId?: unknown; reason?: unknown }
    | null;
  const userId = z.string().uuid().safeParse(body?.userId);
  if (!userId.success) {
    return NextResponse.json({ error: MANUAL_LINK_INVALID_USER_MESSAGE }, { status: 400 });
  }
  const reason = parseManualLinkReason(body?.reason);
  if (!reason.ok) {
    return NextResponse.json({ error: reason.message }, { status: 400 });
  }

  try {
    const result = await linkReferralCustomerManually({
      affiliateId: affiliateId.data,
      userId: userId.data,
      reason: reason.reason,
      adminEmail: authz.actor.email,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ReferralOperationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[referral] failed to link customer manually", error);
    return NextResponse.json({ error: "Erro ao vincular o indicado" }, { status: 500 });
  }
}
