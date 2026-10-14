import { NextResponse } from "next/server";
import type { BackofficeActor } from "@/lib/auth/rbac-core";

/**
 * Cliente de agência externa: só o admin da Automatize vê (ADR 0044). As rotas de plataforma que
 * checam só o cargo (vencimento, créditos, cobrança, CRM…) usam isto para recusar como se a conta
 * não existisse.
 */
export function isHiddenClient(actor: BackofficeActor, userId: string | null | undefined): boolean {
  return Boolean(userId && actor.hiddenUserIds?.includes(userId));
}

export function hiddenClientResponse(): NextResponse<never> {
  return NextResponse.json({ error: "Not found" }, { status: 404 }) as NextResponse<never>;
}
