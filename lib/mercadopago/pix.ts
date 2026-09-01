import "server-only";

import { randomUUID } from "node:crypto";
import { addDays } from "date-fns";
import { Resend } from "resend";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  mercadopagoPaymentLink,
  subscription,
  user,
  type MercadoPagoPaymentLink,
  type PlanType,
} from "@/lib/db/schema";
import { ensurePixCopyPasteCode } from "@/lib/mercadopago/pix-payment";
import { getCommitmentMonths, PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import { formatInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { assertPixRenewalAllowed } from "@/lib/backoffice/pix-renewal-policy";
import { isVindiSubscriptionsEnabled } from "@/lib/vindi/config";

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

function getMercadoPagoWebhookUrl(): string {
  const explicitWebhookUrl = process.env.MERCADOPAGO_WEBHOOK_URL;
  if (explicitWebhookUrl) return explicitWebhookUrl.replace(/\/$/, "");

  const explicitWebhookBaseUrl = process.env.MERCADOPAGO_WEBHOOK_BASE_URL;
  if (explicitWebhookBaseUrl) {
    return `${explicitWebhookBaseUrl.replace(/\/$/, "")}/api/mercadopago/webhook`;
  }

  return `${getFrontendAppUrl()}/api/mercadopago/webhook`;
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
};

async function resolvePixCopyPasteCode(
  link: MercadoPagoPaymentLink,
  email: string,
): Promise<{ link: MercadoPagoPaymentLink; pixCopyPasteCode: string }> {
  const pixDetails = await ensurePixCopyPasteCode({
    link,
    email,
    notificationUrl: getMercadoPagoWebhookUrl(),
  });

  if (pixDetails.paymentId !== link.mercadopagoPaymentId) {
    const [updated] = await db
      .update(mercadopagoPaymentLink)
      .set({
        mercadopagoPaymentId: pixDetails.paymentId,
        preferenceId: pixDetails.paymentId,
        initPoint: pixDetails.pixCopyPasteCode,
        updatedAt: new Date(),
      })
      .where(eq(mercadopagoPaymentLink.id, link.id))
      .returning();

    return {
      link: updated ?? link,
      pixCopyPasteCode: pixDetails.pixCopyPasteCode,
    };
  }

  return {
    link,
    pixCopyPasteCode: pixDetails.pixCopyPasteCode,
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
  if (isVindiSubscriptionsEnabled()) {
    throw new Error(
      "A geração de links Mercado Pago foi desligada no corte. O webhook permanece só para a cauda de 7 dias.",
    );
  }
  const activeSubscriptions = await db
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.userId, userId),
        inArray(subscription.status, ["active", "trialing", "past_due"]),
      ),
    );

  assertPixRenewalAllowed(activeSubscriptions);

  const [targetUser] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!targetUser) throw new Error("Usuário não encontrado.");

  const amount = getPixPlanAmountCentavos(planType);
  const now = new Date();
  const [existing] = await db
    .select()
    .from(mercadopagoPaymentLink)
    .where(
      and(
        eq(mercadopagoPaymentLink.userId, userId),
        eq(mercadopagoPaymentLink.planType, planType),
        eq(mercadopagoPaymentLink.amount, amount),
        eq(mercadopagoPaymentLink.status, "pending"),
        gt(mercadopagoPaymentLink.expiresAt, now),
      ),
    )
    .orderBy(desc(mercadopagoPaymentLink.createdAt))
    .limit(1);

  if (existing) {
    const linkForPix =
      existing.initPoint.startsWith("http://") ||
      existing.initPoint.startsWith("https://")
        ? { ...existing, mercadopagoPaymentId: null }
        : existing;

    if (linkForPix.adminEmail !== adminEmail) {
      const [updated] = await db
        .update(mercadopagoPaymentLink)
        .set({ adminEmail, updatedAt: now })
        .where(eq(mercadopagoPaymentLink.id, linkForPix.id))
        .returning();

      const resolved = await resolvePixCopyPasteCode(
        updated ?? linkForPix,
        targetUser.email,
      );
      return {
        ...resolved.link,
        reused: true,
        pixCopyPasteCode: resolved.pixCopyPasteCode,
      };
    }

    const resolved = await resolvePixCopyPasteCode(linkForPix, targetUser.email);
    return {
      ...resolved.link,
      reused: true,
      pixCopyPasteCode: resolved.pixCopyPasteCode,
    };
  }

  const id = randomUUID();
  const expiresAt = addDays(now, PIX_LINK_VALIDITY_DAYS);

  const [created] = await db
    .insert(mercadopagoPaymentLink)
    .values({
      id,
      userId,
      planType,
      amount,
      currency: "brl",
      preferenceId: id,
      initPoint: "",
      status: "pending",
      source: "backoffice",
      adminEmail,
      expiresAt,
    })
    .returning();

  if (!created) throw new Error("Falha ao salvar Pix.");

  const resolved = await resolvePixCopyPasteCode(created, targetUser.email);
  return {
    ...resolved.link,
    reused: false,
    pixCopyPasteCode: resolved.pixCopyPasteCode,
  };
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
