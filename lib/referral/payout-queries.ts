// A fila de saques do programa de afiliados v2 (ticket 11).
//
// Duas decisões deste arquivo carregam dinheiro:
//
//   1. **O Lançamento negativo entra SÓ na transição para pago.** Um pedido
//      aberto não escreve nada no ledger, e um pedido negado não deixa rastro
//      de dinheiro que nunca se moveu (ADR 0026). Enquanto o pedido está
//      aberto, ele sai do saldo disponível por subtração, no cálculo do saldo.
//   2. **O que o operador vê é o snapshot do documento**, gravado quando o
//      pedido foi feito — nunca o cadastro de agora. Uma alteração cadastral
//      posterior não pode confundir o que foi pago (história 49).
//
// Toda decisão grava autor e data: nas colunas do pedido e numa linha de
// `referral_admin_actions`, que é o histórico que sobrevive a uma correção.

import { asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  referralAdminAction,
  referralAffiliate,
  referralLedgerEntry,
  referralPayoutRequest,
  user,
  type ReferralPayoutRequest,
  type ReferralPayoutStatus,
  type ReferralTaxDocumentType,
} from "@/lib/db/schema";
import { canTransitionReferralPayout } from "./payout";
import { ReferralOperationError } from "./queries";

export type ReferralPayoutListItem = {
  id: string;
  affiliateId: string;
  affiliateCode: string;
  amountCentavos: number;
  status: ReferralPayoutStatus;
  /** COMO ESTAVA no momento do pedido. Nunca o cadastro de agora. */
  taxDocument: { document: string; type: ReferralTaxDocumentType };
  adminEmail: string | null;
  proofUrl: string | null;
  denialReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
  user: { id: string; email: string; name: string | null };
};

export async function listReferralPayoutRequests(
  filters: { status?: ReferralPayoutStatus },
  limit = 50,
  offset = 0,
): Promise<ReferralPayoutListItem[]> {
  const rows = await db
    .select({
      payout: referralPayoutRequest,
      affiliate: { id: referralAffiliate.id, code: referralAffiliate.code },
      user: { id: user.id, email: user.email, name: user.name },
    })
    .from(referralPayoutRequest)
    .innerJoin(
      referralAffiliate,
      eq(referralAffiliate.id, referralPayoutRequest.affiliateId),
    )
    .innerJoin(user, eq(user.id, referralAffiliate.userId))
    .where(
      filters.status
        ? eq(referralPayoutRequest.status, filters.status)
        : undefined,
    )
    // Os abertos primeiro e, dentro de cada grupo, o mais antigo antes: uma
    // fila em que quem espera há mais tempo aparece por último não é fila.
    .orderBy(
      asc(
        sql`CASE WHEN ${referralPayoutRequest.status} IN ('requested', 'approved') THEN 0 ELSE 1 END`,
      ),
      asc(referralPayoutRequest.createdAt),
    )
    .limit(limit)
    .offset(offset);

  return rows.map(({ payout, affiliate, user: affiliateUser }) => ({
    id: payout.id,
    affiliateId: affiliate.id,
    affiliateCode: affiliate.code,
    amountCentavos: payout.amountCentavos,
    status: payout.status,
    taxDocument: {
      document: payout.taxDocumentSnapshot,
      type: payout.taxDocumentTypeSnapshot,
    },
    adminEmail: payout.adminEmail,
    proofUrl: payout.proofUrl,
    denialReason: payout.denialReason,
    createdAt: payout.createdAt.toISOString(),
    reviewedAt: payout.reviewedAt?.toISOString() ?? null,
    paidAt: payout.paidAt?.toISOString() ?? null,
    user: affiliateUser,
  }));
}

/** Quantos saques estão em cada estado — o topo da fila. */
export async function summarizeReferralPayoutQueue(): Promise<
  Record<ReferralPayoutStatus, number>
> {
  const rows = await db
    .select({ status: referralPayoutRequest.status, total: count() })
    .from(referralPayoutRequest)
    .groupBy(referralPayoutRequest.status);

  // Os cinco estados sempre, mesmo os zerados: um estado que some da tela
  // obriga o operador a saber de cor quais existem.
  const totals: Record<ReferralPayoutStatus, number> = {
    requested: 0,
    approved: 0,
    paid: 0,
    denied: 0,
    cancelled: 0,
  };
  for (const row of rows) totals[row.status] = row.total;
  return totals;
}

const ADMIN_ACTION_BY_STATUS = {
  approved: "payout_approved",
  paid: "payout_paid",
  denied: "payout_denied",
} as const;

export type ReferralPayoutDecision = keyof typeof ADMIN_ACTION_BY_STATUS;

export const REFERRAL_PAYOUT_DECISIONS = Object.keys(
  ADMIN_ACTION_BY_STATUS,
) as ReferralPayoutDecision[];

/**
 * Move o pedido — aprovar, marcar como pago (com comprovante) ou negar.
 *
 * O `SELECT ... FOR UPDATE` e a tabela de transições, juntos, são o que impede
 * dois cliques simultâneos de pagarem duas vezes; o `event_key` único do
 * Lançamento é a segunda rede, para o caso de a transação cair entre as duas
 * escritas.
 */
export async function decideReferralPayout({
  payoutId,
  status,
  proofUrl,
  reason,
  adminEmail,
}: {
  payoutId: string;
  status: ReferralPayoutDecision;
  proofUrl?: string | null;
  reason?: string | null;
  adminEmail: string;
}): Promise<ReferralPayoutRequest> {
  if (status === "paid") {
    const trimmed = proofUrl?.trim() ?? "";
    if (trimmed.length === 0) {
      throw new ReferralOperationError(
        400,
        "Informe o comprovante antes de registrar o pagamento",
      );
    }
    try {
      if (new URL(trimmed).protocol !== "https:") throw new Error();
    } catch {
      throw new ReferralOperationError(
        400,
        "O comprovante deve usar uma URL HTTPS válida",
      );
    }
  }

  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(referralPayoutRequest)
      .where(eq(referralPayoutRequest.id, payoutId))
      .limit(1)
      .for("update");
    if (!request) {
      throw new ReferralOperationError(404, "Pedido de saque não encontrado");
    }

    if (!canTransitionReferralPayout(request.status, status)) {
      throw new ReferralOperationError(
        409,
        `Transição inválida do saque: ${request.status} → ${status}`,
      );
    }

    const now = new Date();
    const [updated] = await tx
      .update(referralPayoutRequest)
      .set({
        status,
        // `admin_email` e `reviewed_at` guardam a PRIMEIRA revisão — quem
        // olhou o pedido e decidiu — e não a última escrita. Sobrescrever a
        // cada decisão apagava o aprovador no instante do pagamento, e é
        // justamente o par aprovador/pagador que torna o repasse auditável.
        // Quem pagou está no `created_by` do Lançamento e em
        // `referral_admin_actions`, que registra toda decisão, uma linha cada.
        adminEmail: request.adminEmail ?? adminEmail,
        reviewedAt: request.reviewedAt ?? now,
        proofUrl: status === "paid" ? proofUrl!.trim() : request.proofUrl,
        denialReason: status === "denied" ? (reason ?? null) : request.denialReason,
        paidAt: status === "paid" ? now : request.paidAt,
        updatedAt: now,
      })
      .where(eq(referralPayoutRequest.id, payoutId))
      .returning();

    // O único ponto do programa em que um saque vira dinheiro que saiu.
    // `available_at` nulo: um saque pago não cumpre carência nenhuma.
    if (status === "paid") {
      await tx
        .insert(referralLedgerEntry)
        .values({
          affiliateId: request.affiliateId,
          type: "payout",
          amountCentavos: -request.amountCentavos,
          eventKey: `referral-payout:${request.id}`,
          payoutRequestId: request.id,
          availableAt: null,
          description: `Saque pago em ${now.toLocaleDateString("pt-BR")}`,
          createdBy: adminEmail,
          createdAt: now,
        })
        .onConflictDoNothing({ target: referralLedgerEntry.eventKey });
    }

    await tx.insert(referralAdminAction).values({
      affiliateId: request.affiliateId,
      adminEmail,
      action: ADMIN_ACTION_BY_STATUS[status],
      reason: reason ?? null,
      details: {
        payoutRequestId: request.id,
        amountCentavos: request.amountCentavos,
        from: request.status,
        to: status,
        proofUrl: status === "paid" ? proofUrl!.trim() : null,
      },
      createdAt: now,
    });

    return updated;
  });
}
