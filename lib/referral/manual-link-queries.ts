// O vínculo manual de Indicado ligado ao banco. As regras moram em
// `manual-link.ts`, com teste; aqui só se busca estado e se grava a decisão.
//
// A prévia é somente leitura. O vínculo é UMA transação que trava a linha do
// afiliado (o idioma de aprovar/renegociar/bloquear), relê tudo e grava o
// Indicado e a auditoria juntos. A trava única de `referral_customers.user_id`
// é a última palavra contra a corrida — inclusive contra uma atribuição por
// clique gravada pelo frontend no mesmo instante.

import { and, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payment,
  referralAdminAction,
  referralAffiliate,
  referralAgreement,
  referralCustomer,
  user,
} from "@/lib/db/schema";
import type { ReferralAgreementTerms } from "./agreement";
import {
  isReferralCustomerUserUniqueViolation,
  MANUAL_LINK_AFFILIATE_NOT_FOUND_MESSAGE,
  MANUAL_LINK_USER_NOT_FOUND_MESSAGE,
  planManualReferralLink,
  type ManualLinkCharges,
  type ManualLinkState,
} from "./manual-link";
import { ReferralOperationError } from "./queries";

type Executor =
  | typeof db
  | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

export type ManualLinkPreview = {
  user: { id: string; email: string; name: string | null };
  /** Por que o vínculo seria recusado agora — as recusas 409 de R7. */
  blocked: { message: string } | null;
  agreement: ReferralAgreementTerms | null;
  charges: ManualLinkCharges;
};

export type ManualLinkResult = {
  customerId: string;
  agreementId: string;
  signedUpAt: string;
};

type LoadedManualLink = {
  state: ManualLinkState;
  agreement: (ReferralAgreementTerms & { id: string }) | null;
  user: { id: string; email: string; name: string | null } | null;
};

async function loadManualLinkState(
  executor: Executor,
  affiliateId: string,
  userId: string,
  lockAffiliate: boolean,
): Promise<LoadedManualLink> {
  const affiliateQuery = executor
    .select({
      id: referralAffiliate.id,
      status: referralAffiliate.status,
      userId: referralAffiliate.userId,
    })
    .from(referralAffiliate)
    .where(eq(referralAffiliate.id, affiliateId))
    .limit(1);
  const [affiliateRow] = lockAffiliate
    ? await affiliateQuery.for("update")
    : await affiliateQuery;
  if (!affiliateRow) {
    throw new ReferralOperationError(404, MANUAL_LINK_AFFILIATE_NOT_FOUND_MESSAGE);
  }

  const [agreementRow] = await executor
    .select({
      id: referralAgreement.id,
      format: referralAgreement.format,
      percentageBps: referralAgreement.percentageBps,
      fixedAmountCentavos: referralAgreement.fixedAmountCentavos,
      duration: referralAgreement.duration,
      durationCycles: referralAgreement.durationCycles,
    })
    .from(referralAgreement)
    .where(
      and(
        eq(referralAgreement.affiliateId, affiliateId),
        isNull(referralAgreement.supersededAt),
      ),
    )
    .limit(1);

  const [userRow] = await executor
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  // O dono atual deste usuário, de qualquer afiliado — com o nome (ou e-mail)
  // do afiliado dono para a mensagem de recusa.
  const [existingRow] = await executor
    .select({
      affiliateId: referralCustomer.affiliateId,
      signedUpAt: referralCustomer.signedUpAt,
      ownerName: user.name,
      ownerEmail: user.email,
    })
    .from(referralCustomer)
    .innerJoin(referralAffiliate, eq(referralAffiliate.id, referralCustomer.affiliateId))
    .innerJoin(user, eq(user.id, referralAffiliate.userId))
    .where(eq(referralCustomer.userId, userId))
    .limit(1);

  return {
    state: {
      affiliate: affiliateRow,
      agreement: agreementRow ? { id: agreementRow.id } : null,
      user: userRow ? { id: userRow.id, createdAt: userRow.createdAt } : null,
      existingCustomer: existingRow
        ? {
            affiliateId: existingRow.affiliateId,
            affiliateLabel: existingRow.ownerName?.trim() || existingRow.ownerEmail,
            signedUpAt: existingRow.signedUpAt,
          }
        : null,
    },
    agreement: agreementRow ?? null,
    user: userRow ? { id: userRow.id, email: userRow.email, name: userRow.name } : null,
  };
}

/**
 * As cobranças que a varredura do motor vai processar para este usuário. Os
 * cortes copiam `findPaymentsPendingCommission` (automatize-frontend
 * `lib/referral/queries.ts`): se a varredura mudar, esta prévia muda junto.
 */
async function countManualLinkCharges(
  executor: Executor,
  userId: string,
): Promise<ManualLinkCharges> {
  const [row] = await executor
    .select({
      eligibleCount: sql<number>`count(*)::int`,
      netCentavos: sql<number>`coalesce(sum(${payment.netAmount}), 0)::int`,
      awaitingSettlementCount: sql<number>`(count(*) filter (where ${payment.netAmount} is null))::int`,
    })
    .from(payment)
    .where(
      and(
        eq(payment.userId, userId),
        eq(payment.status, "succeeded"),
        or(isNull(payment.purpose), eq(payment.purpose, "subscription")),
        isNotNull(payment.externalId),
        gt(sql`coalesce(${payment.grossAmount}, ${payment.amount})`, 0),
      ),
    );
  return {
    eligibleCount: Number(row?.eligibleCount ?? 0),
    netCentavos: Number(row?.netCentavos ?? 0),
    awaitingSettlementCount: Number(row?.awaitingSettlementCount ?? 0),
  };
}

export async function previewManualReferralLink(
  affiliateId: string,
  userId: string,
  now: Date = new Date(),
): Promise<ManualLinkPreview> {
  const loaded = await loadManualLinkState(db, affiliateId, userId, false);
  if (!loaded.user) {
    throw new ReferralOperationError(404, MANUAL_LINK_USER_NOT_FOUND_MESSAGE);
  }
  const decision = planManualReferralLink(loaded.state, now);
  const charges = await countManualLinkCharges(db, userId);
  return {
    user: loaded.user,
    blocked: decision.ok ? null : { message: decision.message },
    agreement: loaded.agreement
      ? {
          format: loaded.agreement.format,
          percentageBps: loaded.agreement.percentageBps,
          fixedAmountCentavos: loaded.agreement.fixedAmountCentavos,
          duration: loaded.agreement.duration,
          durationCycles: loaded.agreement.durationCycles,
        }
      : null,
    charges,
  };
}

export async function linkReferralCustomerManually(args: {
  affiliateId: string;
  userId: string;
  reason: string;
  adminEmail: string;
  now?: Date;
}): Promise<ManualLinkResult> {
  const now = args.now ?? new Date();
  try {
    return await db.transaction(async (tx) => {
      const loaded = await loadManualLinkState(tx, args.affiliateId, args.userId, true);
      const decision = planManualReferralLink(loaded.state, now);
      if (!decision.ok) {
        throw new ReferralOperationError(decision.status, decision.message);
      }

      const [customer] = await tx
        .insert(referralCustomer)
        .values({
          userId: args.userId,
          affiliateId: args.affiliateId,
          agreementId: decision.agreementId,
          signedUpAt: decision.signedUpAt,
          createdAt: now,
        })
        .returning({ id: referralCustomer.id });

      await tx.insert(referralAdminAction).values({
        affiliateId: args.affiliateId,
        adminEmail: args.adminEmail,
        action: "customer_linked",
        reason: args.reason,
        details: {
          customerId: customer.id,
          userId: args.userId,
          userEmail: loaded.user?.email ?? null,
          agreementId: decision.agreementId,
        },
        createdAt: now,
      });

      return {
        customerId: customer.id,
        agreementId: decision.agreementId,
        signedUpAt: decision.signedUpAt.toISOString(),
      };
    });
  } catch (error) {
    if (!isReferralCustomerUserUniqueViolation(error)) throw error;
    // Corrida perdida: outro vínculo (manual ou por clique) gravou este usuário
    // entre a leitura e a escrita. Relê para dizer de quem ele é agora.
    const loaded = await loadManualLinkState(db, args.affiliateId, args.userId, false);
    const decision = planManualReferralLink(loaded.state, now);
    throw new ReferralOperationError(
      409,
      decision.ok ? "Este usuário acabou de ser vinculado a um afiliado" : decision.message,
    );
  }
}
