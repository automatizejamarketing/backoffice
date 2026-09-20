import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { addDays } from "date-fns";
import { Resend } from "resend";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  mercadopagoPaymentLink,
  retentionFinancialBenefit,
  subscription,
  user,
  type MercadoPagoPaymentLink,
  type PlanType,
} from "@/lib/db/schema";
import {
  cancelMercadoPagoPixPayment,
  createMercadoPagoPixPayment,
  getMercadoPagoPixPayment,
  isPayableMercadoPagoPixStatus,
  isTerminalMercadoPagoPixStatus,
} from "@/lib/mercadopago/pix-payment";
import { getCommitmentMonths, PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import { formatInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { assertPixRenewalAllowed } from "@/lib/backoffice/pix-renewal-policy";
import {
  BackofficePixRetentionConflictError,
  calculateRetentionPixAmounts,
  resolveRetentionPixProviderState,
} from "./pix-retention-contract";
export {
  BackofficePixRetentionConflictError,
  calculateRetentionPixAmounts,
  type BackofficePixRetentionConflictCode,
  isPayableMercadoPagoPixStatus,
  resolveRetentionPixProviderState,
} from "./pix-retention-contract";

const PIX_LINK_VALIDITY_DAYS = 7;
const resend = new Resend(process.env.RESEND_API_KEY);

function getFrontendAppUrl(): string {
  return (
    process.env.FRONTEND_APP_URL ??
    process.env.NEXT_PUBLIC_FRONTEND_APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

/**
 * O Mercado Pago recusa `notification_url` que não seja https público — e um
 * link criado com uma URL que ele aceitou mas não alcança nunca recebe webhook.
 * Espelha `getPublicNotificationUrlField` do frontend: na dúvida, manda sem.
 */
function isPublicWebhookUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return (
      url.protocol === "https:" &&
      url.hostname !== "localhost" &&
      !url.hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

function getMercadoPagoWebhookUrl(): string {
  const explicitWebhookUrl = process.env.MERCADOPAGO_WEBHOOK_URL;
  if (explicitWebhookUrl) return explicitWebhookUrl.replace(/\/$/, "");

  const explicitWebhookBaseUrl = process.env.MERCADOPAGO_WEBHOOK_BASE_URL;
  if (explicitWebhookBaseUrl) {
    return `${explicitWebhookBaseUrl.replace(/\/$/, "")}/api/mercadopago/webhook`;
  }

  return `${getFrontendAppUrl()}/api/mercadopago/webhook`;
}

/** A URL de webhook, ou string vazia quando ela não é alcançável pela MP. */
export function getPublicMercadoPagoWebhookUrl(): string {
  const candidate = getMercadoPagoWebhookUrl();
  return isPublicWebhookUrl(candidate) ? candidate : "";
}

function getFromAddress(): string {
  const configured = process.env.RESEND_FROM_EMAIL;
  if (configured) return configured;

  if (process.env.NODE_ENV === "development") {
    return "Automatize Marketing <onboarding@resend.dev>";
  }

  throw new Error("RESEND_FROM_EMAIL is not configured");
}

function getPixPlanAmountCentavos(planType: PlanType): number {
  if (process.env.NODE_ENV === "development") {
    const testAmount = Number(process.env.MERCADOPAGO_PIX_TEST_AMOUNT_CENTAVOS);
    if (Number.isInteger(testAmount) && testAmount > 0) return testAmount;
  }

  return PLAN_DEFINITIONS[planType].totalCommitmentCentavos;
}

function getPixCommitmentMonths(planType: PlanType): 1 | 3 | 6 | 12 {
  return getCommitmentMonths(planType);
}

export type BackofficePixLinkResult = MercadoPagoPaymentLink & {
  reused: boolean;
  pixCopyPasteCode: string;
  originalAmountCentavos: number | null;
  discountPercent: number | null;
  discountAmountCentavos: number | null;
  finalAmountCentavos: number;
  retentionBenefitId: string | null;
};

function retentionEmissionId(benefitId: string, generation: number): string {
  const hex = createHash("sha256")
    .update(`mercadopago-retention:${benefitId}:${generation}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type PixExecutor = typeof db;

function resultFromLink(
  link: MercadoPagoPaymentLink,
  pixCopyPasteCode: string,
  reused: boolean,
  amounts?: {
    originalAmountCentavos: number;
    discountAmountCentavos: number;
    finalAmountCentavos: number;
  },
): BackofficePixLinkResult {
  return {
    ...link,
    reused,
    pixCopyPasteCode,
    originalAmountCentavos:
      amounts?.originalAmountCentavos ?? link.originalAmount ?? null,
    discountPercent: link.discountPercent,
    discountAmountCentavos:
      amounts?.discountAmountCentavos ?? link.discountAmount ?? null,
    finalAmountCentavos: amounts?.finalAmountCentavos ?? link.amount,
    retentionBenefitId: link.retentionBenefitId,
  };
}

export function serializeBackofficePixLink(link: BackofficePixLinkResult) {
  return {
    id: link.id,
    planType: link.planType,
    amount: link.amount,
    originalAmount: link.originalAmountCentavos,
    discountPercent: link.discountPercent,
    discountAmount: link.discountAmountCentavos,
    finalAmount: link.finalAmountCentavos,
    retentionBenefitId: link.retentionBenefitId,
    currency: link.currency,
    preferenceId: link.preferenceId,
    initPoint: link.initPoint,
    pixCopyPasteCode: link.pixCopyPasteCode,
    mercadopagoPaymentId: link.mercadopagoPaymentId,
    status: link.status,
    source: link.source,
    adminEmail: link.adminEmail,
    expiresAt: link.expiresAt.toISOString(),
    createdAt: link.createdAt.toISOString(),
  };
}

export async function createOrReuseBackofficePixLink({
  userId,
  planType,
  adminEmail,
}: {
  userId: string;
  planType: PlanType;
  adminEmail: string;
}): Promise<BackofficePixLinkResult> {
  return db.transaction((tx) =>
    createBackofficePixLinkInTransaction({
      executor: tx as unknown as PixExecutor,
      userId,
      planType,
      adminEmail,
    }),
  );
}

async function createBackofficePixLinkInTransaction({
  executor,
  userId,
  planType,
  adminEmail,
}: {
  executor: PixExecutor;
  userId: string;
  planType: PlanType;
  adminEmail: string;
}): Promise<BackofficePixLinkResult> {
  // This is deliberately the first lock. Frontend checkout and renewal jobs
  // take the same users -> benefit -> links order on the shared database.
  const [targetUser] = await executor
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
    .for("update");
  if (!targetUser) throw new Error("Usuário não encontrado.");

  const activeSubscriptions = await executor
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.userId, userId),
        inArray(subscription.status, ["active", "trialing", "past_due"]),
      ),
    );
  assertPixRenewalAllowed(activeSubscriptions);

  const [benefit] = await executor
    .select()
    .from(retentionFinancialBenefit)
    .where(eq(retentionFinancialBenefit.userId, userId))
    .limit(1)
    .for("update");

  const regularAmount = getPixPlanAmountCentavos(planType);
  const now = new Date();
  let retentionAmounts: ReturnType<typeof calculateRetentionPixAmounts> | null = null;
  const activeBenefit =
    benefit &&
    (benefit.status === "reserved" || benefit.status === "applied")
      ? benefit
      : null;

  if (benefit && benefit.status !== "consumed" && !activeBenefit) {
    throw new BackofficePixRetentionConflictError(
      "retention_reconciliation_required",
      "Retention benefit requires reconciliation before a Pix can be issued",
      { benefitId: benefit.id, status: benefit.status },
    );
  }
  if (activeBenefit) {
    if (activeBenefit.provider !== "mercadopago") {
      throw new BackofficePixRetentionConflictError(
        "retention_provider_mismatch",
        "Retention benefit belongs to another payment provider",
        { benefitId: activeBenefit.id, provider: activeBenefit.provider },
      );
    }
    if (activeBenefit.planType !== planType) {
      throw new BackofficePixRetentionConflictError(
        "retention_provider_mismatch",
        "Retention benefit is for a different plan",
        { benefitId: activeBenefit.id, planType: activeBenefit.planType },
      );
    }
    retentionAmounts = calculateRetentionPixAmounts({
      originalAmountCentavos: activeBenefit.originalAmount,
      discountPercent: activeBenefit.discountPercent,
      discountAmountCentavos: activeBenefit.discountAmount,
    });
  }

  const links = await executor
    .select()
    .from(mercadopagoPaymentLink)
    .where(
      and(
        eq(mercadopagoPaymentLink.userId, userId),
        eq(mercadopagoPaymentLink.planType, planType),
        inArray(mercadopagoPaymentLink.status, ["pending", "expired", "canceled"]),
        isNotNull(mercadopagoPaymentLink.mercadopagoPaymentId),
      ),
    )
    .orderBy(desc(mercadopagoPaymentLink.createdAt))
    .for("update");

  const checkedProviderIds = new Set<string>();
  for (const link of links) {
    if (!link.mercadopagoPaymentId) continue;
    checkedProviderIds.add(link.mercadopagoPaymentId);
    let provider;
    try {
      provider = await getMercadoPagoPixPayment(link.mercadopagoPaymentId);
    } catch (error) {
      throw new BackofficePixRetentionConflictError(
        "retention_reconciliation_required",
        "Mercado Pago payment status could not be reconciled",
        { providerPaymentId: link.mercadopagoPaymentId, linkId: link.id, cause: error instanceof Error ? error.message : undefined },
      );
    }
    if (!provider) {
      throw new BackofficePixRetentionConflictError(
        "retention_reconciliation_required",
        "Mercado Pago payment could not be found",
        { providerPaymentId: link.mercadopagoPaymentId, linkId: link.id },
      );
    }
    if (provider.status === "approved") {
      throw new BackofficePixRetentionConflictError(
        "retention_payment_paid",
        "A Mercado Pago renewal was paid and must be settled before retrying",
        { providerPaymentId: link.mercadopagoPaymentId, linkId: link.id },
      );
    }
    if (isPayableMercadoPagoPixStatus(provider.status)) {
      if (activeBenefit && link.retentionBenefitId === activeBenefit.id) {
        if (
          link.originalAmount !== retentionAmounts?.originalAmountCentavos ||
          link.discountPercent !== activeBenefit.discountPercent ||
          link.discountAmount !== retentionAmounts.discountAmountCentavos ||
          link.amount !== retentionAmounts.finalAmountCentavos
        ) {
          throw new BackofficePixRetentionConflictError(
            "retention_snapshot_mismatch",
            "Stored discounted Pix does not match the retention benefit snapshot",
            { benefitId: activeBenefit.id, linkId: link.id },
          );
        }
        const resolution = await resolveRetentionPixProviderState({
          provider: {
            status: provider.status,
            transactionAmountCentavos:
              typeof provider.transaction_amount === "number"
                ? Math.round(provider.transaction_amount * 100)
                : typeof provider.transaction_amount === "string"
                  ? Math.round(Number(provider.transaction_amount) * 100)
                  : undefined,
            pixCopyPasteCode: provider.point_of_interaction?.transaction_data?.qr_code,
          },
          linkId: link.id,
          linkBenefitId: link.retentionBenefitId,
          benefitId: activeBenefit.id,
          linkAmountCentavos: link.amount,
          expectedAmountCentavos: retentionAmounts.finalAmountCentavos,
          pixCopyPasteCode: link.pixCopyPaste,
          cancel: () => cancelMercadoPagoPixPayment(link.mercadopagoPaymentId!),
        });
        if (resolution.kind === "replace") {
          await executor
            .update(mercadopagoPaymentLink)
            .set({ status: "expired", updatedAt: now })
            .where(eq(mercadopagoPaymentLink.id, link.id));
          continue;
        }
        const [updated] = await executor
          .update(mercadopagoPaymentLink)
          .set({ status: "pending", adminEmail, updatedAt: now })
          .where(eq(mercadopagoPaymentLink.id, link.id))
          .returning();
        return resultFromLink(
          updated ?? link,
          resolution.pixCopyPasteCode,
          true,
          retentionAmounts,
        );
      }
      if (link.retentionBenefitId) {
        throw new BackofficePixRetentionConflictError(
          "retention_reconciliation_required",
          "Another discounted Pix is still payable",
          { linkId: link.id, retentionBenefitId: link.retentionBenefitId },
        );
      }
      if (!activeBenefit && link.amount === regularAmount && !link.retentionBenefitId) {
        const code = provider.point_of_interaction?.transaction_data?.qr_code ??
          link.pixCopyPaste;
        if (!code) {
          throw new BackofficePixRetentionConflictError(
            "retention_reconciliation_required",
            "Payable Mercado Pago payment has no Pix code",
            { providerPaymentId: link.mercadopagoPaymentId, linkId: link.id },
          );
        }
        const [updated] = await executor
          .update(mercadopagoPaymentLink)
          .set({ status: "pending", adminEmail, updatedAt: now })
          .where(eq(mercadopagoPaymentLink.id, link.id))
          .returning();
        return resultFromLink(updated ?? link, code, true);
      }
      if (!activeBenefit) {
        throw new BackofficePixRetentionConflictError(
          "retention_reconciliation_required",
          "A payable Mercado Pago payment already exists for this renewal",
          { linkId: link.id },
        );
      }
      let cancelled;
      try {
        cancelled = await cancelMercadoPagoPixPayment(link.mercadopagoPaymentId);
      } catch (error) {
        throw new BackofficePixRetentionConflictError(
          "retention_reconciliation_required",
          "Mercado Pago did not confirm cancellation of the previous payment",
          { linkId: link.id, cause: error instanceof Error ? error.message : undefined },
        );
      }
      if (!isTerminalMercadoPagoPixStatus(cancelled.status)) {
        throw new BackofficePixRetentionConflictError(
          "retention_reconciliation_required",
          "Mercado Pago cancellation result is not terminal",
          { linkId: link.id, providerStatus: cancelled.status },
        );
      }
      await executor
        .update(mercadopagoPaymentLink)
        .set({ status: "expired", updatedAt: now })
        .where(eq(mercadopagoPaymentLink.id, link.id));
      continue;
    }
    if (isTerminalMercadoPagoPixStatus(provider.status)) {
      await executor
        .update(mercadopagoPaymentLink)
        .set({ status: "expired", updatedAt: now })
        .where(eq(mercadopagoPaymentLink.id, link.id));
      continue;
    }
    throw new BackofficePixRetentionConflictError(
      "retention_reconciliation_required",
      "Mercado Pago returned an unknown payment status",
      { providerPaymentId: link.mercadopagoPaymentId, providerStatus: provider.status },
    );
  }

  if (activeBenefit?.providerPaymentId && !checkedProviderIds.has(activeBenefit.providerPaymentId)) {
    let provider;
    try {
      provider = await getMercadoPagoPixPayment(activeBenefit.providerPaymentId);
    } catch (error) {
      throw new BackofficePixRetentionConflictError(
        "retention_reconciliation_required",
        "Retention provider payment status could not be reconciled",
        { benefitId: activeBenefit.id, providerPaymentId: activeBenefit.providerPaymentId, cause: error instanceof Error ? error.message : undefined },
      );
    }
    if (!provider || (!isTerminalMercadoPagoPixStatus(provider.status) && provider.status !== "rejected")) {
      throw new BackofficePixRetentionConflictError(
        provider?.status === "approved" ? "retention_payment_paid" : "retention_reconciliation_required",
        "Retention benefit has a provider payment requiring reconciliation",
        { benefitId: activeBenefit.id, providerPaymentId: activeBenefit.providerPaymentId, providerStatus: provider?.status },
      );
    }
  }

  if (activeBenefit && retentionAmounts) {
    const priorEmissions = await executor
      .select({ id: mercadopagoPaymentLink.id })
      .from(mercadopagoPaymentLink)
      .where(eq(mercadopagoPaymentLink.retentionBenefitId, activeBenefit.id));
    const id = retentionEmissionId(activeBenefit.id, priorEmissions.length);
    const expiresAt = addDays(now, PIX_LINK_VALIDITY_DAYS);
    let pixDetails;
    try {
      pixDetails = await createMercadoPagoPixPayment({
        linkId: id,
        userId,
        email: targetUser.email,
        planType,
        amountCentavos: retentionAmounts.finalAmountCentavos,
        expiresAt,
        notificationUrl: getPublicMercadoPagoWebhookUrl(),
        providerIdempotencyKey: `retention-pix:${activeBenefit.id}:${id}`,
        retentionBenefitId: activeBenefit.id,
        originalAmountCentavos: retentionAmounts.originalAmountCentavos,
        discountAmountCentavos: retentionAmounts.discountAmountCentavos,
      });
    } catch (error) {
      throw new BackofficePixRetentionConflictError(
        "retention_reconciliation_required",
        "Mercado Pago Pix creation was uncertain; reconcile before retrying",
        { benefitId: activeBenefit.id, idempotencyKey: `retention-pix:${activeBenefit.id}:${id}`, cause: error instanceof Error ? error.message : undefined },
      );
    }
    const [created] = await executor
      .insert(mercadopagoPaymentLink)
      .values({
        id,
        userId,
        planType,
        amount: retentionAmounts.finalAmountCentavos,
        currency: "brl",
        preferenceId: id,
        initPoint: pixDetails.pixCopyPasteCode,
        pixCopyPaste: pixDetails.pixCopyPasteCode,
        mercadopagoPaymentId: pixDetails.paymentId,
        status: "pending",
        source: "backoffice",
        adminEmail,
        expiresAt,
        retentionBenefitId: activeBenefit.id,
        originalAmount: retentionAmounts.originalAmountCentavos,
        discountPercent: activeBenefit.discountPercent,
        discountAmount: retentionAmounts.discountAmountCentavos,
      })
      .returning();
    if (!created) throw new Error("Falha ao salvar Pix.");
    await executor
      .update(retentionFinancialBenefit)
      .set({
        status: "applied",
        providerPaymentId: pixDetails.paymentId,
        appliedAt: now,
        updatedAt: now,
      })
      .where(eq(retentionFinancialBenefit.id, activeBenefit.id));
    return resultFromLink(created, pixDetails.pixCopyPasteCode, false, retentionAmounts);
  }

  const id = randomUUID();
  const expiresAt = addDays(now, PIX_LINK_VALIDITY_DAYS);
  const pixDetails = await createMercadoPagoPixPayment({
    linkId: id,
    userId,
    email: targetUser.email,
    planType,
    amountCentavos: regularAmount,
    expiresAt,
    notificationUrl: getPublicMercadoPagoWebhookUrl(),
  });
  const [created] = await executor
    .insert(mercadopagoPaymentLink)
    .values({
      id,
      userId,
      planType,
      amount: regularAmount,
      currency: "brl",
      preferenceId: id,
      initPoint: pixDetails.pixCopyPasteCode,
      pixCopyPaste: pixDetails.pixCopyPasteCode,
      mercadopagoPaymentId: pixDetails.paymentId,
      status: "pending",
      source: "backoffice",
      adminEmail,
      expiresAt,
    })
    .returning();
  if (!created) throw new Error("Falha ao salvar Pix.");
  return resultFromLink(created, pixDetails.pixCopyPasteCode, false);
}

export async function sendBackofficePixLinkEmail({
  to,
  name,
  link,
  pixCopyPasteCode,
}: {
  to: string;
  name: string;
  link: MercadoPagoPaymentLink;
  pixCopyPasteCode: string;
}) {
  const plan = PLAN_DEFINITIONS[link.planType];
  const months = getPixCommitmentMonths(link.planType);
  const expiresAt = formatInSaoPaulo(link.expiresAt, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const { error } = await resend.emails.send(
    {
      from: getFromAddress(),
      to: [to],
      subject: `Pix para renovar ${plan.name}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
          <p>Olá, ${name}.</p>
          <p>Segue o Pix para pagar o plano <strong>${plan.name}</strong>.</p>
          <p>Período contratado: ${months} ${months === 1 ? "mês" : "meses"}.</p>
          <p style="font-family:monospace;font-size:12px;word-break:break-all;background:#f4f4f5;padding:12px;border-radius:8px">${pixCopyPasteCode}</p>
          <p style="font-size:12px;color:#666">O Pix vence em ${expiresAt}.</p>
        </div>
      `,
      text: `Olá, ${name}. Pix para ${plan.name}:\n\n${pixCopyPasteCode}\n\nVálido até ${expiresAt}.`,
    },
    { idempotencyKey: `backoffice-pix-link:${link.id}` },
  );

  if (error) throw new Error(error.message);
}
