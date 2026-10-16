// Os Indicados de um afiliado para o sheet de `/referrals`, ligados ao banco.
//
// Só busca estado; o selo e as somas moram em `customers.ts`, com teste. A
// lista é a mesma que `countCustomersByAffiliate` conta na tabela da fila —
// toda linha de `referral_customers` do afiliado, inclusive as que uma
// renegociação deixou num acordo superado — para o "N indicados" da tabela e o
// sheet nunca discordarem.

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { billingPaymentPurposeSql } from "@/lib/backoffice/finance-purpose";
import {
  referralAdminAction,
  referralAffiliate,
  referralCommission,
  referralCommissionableEvent,
  referralCustomer,
  user,
  type BillingProvider,
  type ReferralAffiliateStatus,
  type ReferralCommissionStatus,
} from "@/lib/db/schema";
import type { StatusBadgeProps } from "@/lib/subscriptions/derive";
import {
  describeReferralCustomerAccount,
  summarizeReferralAffiliateCustomers,
  summarizeReferralCustomerCommissions,
  type ReferralAffiliateCustomersSummary,
  type ReferralCustomerAccountStatus,
  type ReferralCustomerCommissionSummary,
} from "./customers";
import { indexManualLinks, type ReferralCustomerManualLink } from "./manual-link";

export type ReferralAffiliateCustomerItem = {
  id: string;
  signedUpAt: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    phone: string | null;
  };
  account: StatusBadgeProps & { status: ReferralCustomerAccountStatus };
  commission: ReferralCustomerCommissionSummary;
  /** Vínculo feito por um admin no backoffice (auditoria `customer_linked`). */
  manualLink: ReferralCustomerManualLink | null;
};

export type ReferralAffiliateCustomers = {
  affiliate: {
    id: string;
    code: string;
    status: ReferralAffiliateStatus;
    user: { id: string; email: string; name: string | null };
  };
  summary: ReferralAffiliateCustomersSummary;
  customers: ReferralAffiliateCustomerItem[];
};

// Mesmas subconsultas de `fetchCustomerBaseRows`: o selo do indicado tem que
// ler a conta como a tela de Usuários lê.
const customerUserId = sql.raw('"users"."id"');

export async function getReferralAffiliateCustomers(
  affiliateId: string,
  now: Date = new Date(),
): Promise<ReferralAffiliateCustomers | null> {
  const [affiliateRow] = await db
    .select({
      id: referralAffiliate.id,
      code: referralAffiliate.code,
      status: referralAffiliate.status,
      user: { id: user.id, email: user.email, name: user.name },
    })
    .from(referralAffiliate)
    .innerJoin(user, eq(user.id, referralAffiliate.userId))
    .where(eq(referralAffiliate.id, affiliateId))
    .limit(1);
  if (!affiliateRow) return null;

  const [customerRows, commissionRows, manualLinkRows] = await Promise.all([
    db
      .select({
        id: referralCustomer.id,
        signedUpAt: referralCustomer.signedUpAt,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
        },
        expirationDate: user.expirationDate,
        hasApprovedPayment: sql<boolean>`exists (
          select 1
          from payments p
          where p.user_id = ${customerUserId}
            and p.status = 'succeeded'
            and ${billingPaymentPurposeSql()}
        )`,
        hasSubscription: sql<boolean>`exists (
          select 1
          from subscriptions s
          where s.user_id = ${customerUserId}
        )`,
        scheduledCancel: sql<boolean>`coalesce((
          select s.cancel_at_period_end = true or s.status = 'canceled'
          from subscriptions s
          where s.user_id = ${customerUserId}
          order by s.created_at desc
          limit 1
        ), false)`,
        lastPaymentProvider: sql<BillingProvider | null>`(
          select p.provider
          from payments p
          where p.user_id = ${customerUserId}
            and p.status = 'succeeded'
            and ${billingPaymentPurposeSql()}
          order by p.paid_at desc nulls last, p.created_at desc
          limit 1
        )`,
      })
      .from(referralCustomer)
      .innerJoin(user, eq(user.id, referralCustomer.userId))
      .where(eq(referralCustomer.affiliateId, affiliateId))
      .orderBy(desc(referralCustomer.signedUpAt)),
    db
      .select({
        customerId: referralCommissionableEvent.customerId,
        status: referralCommission.status,
        count: sql<number>`count(*)::int`,
        amountCentavos: sql<number>`coalesce(sum(${referralCommission.amountCentavos}), 0)::int`,
      })
      .from(referralCommission)
      .innerJoin(
        referralCommissionableEvent,
        eq(referralCommissionableEvent.id, referralCommission.eventId),
      )
      .where(eq(referralCommission.affiliateId, affiliateId))
      .groupBy(referralCommissionableEvent.customerId, referralCommission.status),
    db
      .select({
        details: referralAdminAction.details,
        adminEmail: referralAdminAction.adminEmail,
        createdAt: referralAdminAction.createdAt,
      })
      .from(referralAdminAction)
      .where(
        and(
          eq(referralAdminAction.affiliateId, affiliateId),
          eq(referralAdminAction.action, "customer_linked"),
        ),
      ),
  ]);

  const commissionsByCustomer = new Map<
    string,
    { status: ReferralCommissionStatus; count: number; amountCentavos: number }[]
  >();
  for (const row of commissionRows) {
    const rows = commissionsByCustomer.get(row.customerId) ?? [];
    rows.push({
      status: row.status,
      count: Number(row.count),
      amountCentavos: Number(row.amountCentavos),
    });
    commissionsByCustomer.set(row.customerId, rows);
  }

  const manualLinks = indexManualLinks(manualLinkRows);
  const customers = customerRows.map((row) => ({
    id: row.id,
    signedUpAt: row.signedUpAt.toISOString(),
    user: row.user,
    account: describeReferralCustomerAccount(
      {
        expirationDate: row.expirationDate,
        hasApprovedPayment: row.hasApprovedPayment,
        hasSubscription: row.hasSubscription,
        scheduledCancel: row.scheduledCancel,
        lastPaymentProvider: row.lastPaymentProvider,
      },
      now,
    ),
    commission: summarizeReferralCustomerCommissions(
      commissionsByCustomer.get(row.id) ?? [],
    ),
    manualLink: manualLinks.get(row.id) ?? null,
  }));

  return {
    affiliate: affiliateRow,
    summary: summarizeReferralAffiliateCustomers(
      customers.map((customer) => ({
        status: customer.account.status,
        liveCommissionCentavos: customer.commission.liveCentavos,
      })),
    ),
    customers,
  };
}
