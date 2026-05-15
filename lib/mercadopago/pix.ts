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
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";

const PIX_LINK_VALIDITY_DAYS = 7;
const resend = new Resend(process.env.RESEND_API_KEY);
const PIX_MONTHLY_PRICE_CENTAVOS: Record<PlanType, number> = {
  monthly_starter: 29700,
  quarterly_starter: 26567,
  semiannual_starter: 24950,
  annual_starter: 20808,
  monthly_pro: 49700,
  quarterly_pro: 39900,
  semiannual_pro: 33283,
  annual_pro: 29142,
  monthly_premium: 89700,
  quarterly_premium: 69700,
  semiannual_premium: 63700,
  annual_premium: 49700,
};

function getAccessToken(): string {
  const token =
    process.env.MERCADOPAGO_ACCESS_TOKEN ??
    process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!token) throw new Error("MERCADOPAGO_ACCESS_TOKEN is not configured");
  return token;
}

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

function getCheckoutReturnBaseUrl(): string {
  return (
    process.env.MERCADOPAGO_CHECKOUT_RETURN_BASE_URL ?? getFrontendAppUrl()
  ).replace(/\/$/, "");
}

function getFromAddress(): string {
  return (
    process.env.RESEND_FROM_EMAIL ??
    "Automatize Marketing <onboarding@resend.dev>"
  );
}

function getPixPlanAmountCentavos(planType: PlanType): number {
  // Business rule: the reduced Pix amount is only a local developer shortcut.
  // Preview/staging/production must always charge the real plan commitment.
  if (process.env.NODE_ENV === "development") {
    const testAmount = Number(process.env.MERCADOPAGO_PIX_TEST_AMOUNT_CENTAVOS);
    if (Number.isInteger(testAmount) && testAmount > 0) return testAmount;
  }

  return (
    PIX_MONTHLY_PRICE_CENTAVOS[planType] * getPixCommitmentMonths(planType)
  );
}

function getPixCommitmentMonths(planType: PlanType): 1 | 3 | 6 | 12 {
  const period = PLAN_DEFINITIONS[planType].period;
  if (period === "quarterly") return 3;
  if (period === "semiannual") return 6;
  if (period === "annual") return 12;
  return 1;
}

function toBRLUnitAmount(amountCentavos: number): number {
  return Number((amountCentavos / 100).toFixed(2));
}

async function assertPixAvailable(): Promise<void> {
  const response = await fetch("https://api.mercadopago.com/v1/payment_methods", {
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const methods = (await response.json()) as Array<{
    id?: string;
    payment_type_id?: string;
    status?: string;
  }>;
  const pixAvailable = methods.some(
    (method) =>
      method.status === "active" &&
      (method.id === "pix" || method.payment_type_id === "bank_transfer"),
  );

  if (!pixAvailable) {
    throw new Error(
      "Pix is not enabled for this Mercado Pago account. Register a Pix key or use credentials from an account with Pix enabled.",
    );
  }
}

async function createPreference({
  linkId,
  userId,
  email,
  planType,
  amountCentavos,
  expiresAt,
}: {
  linkId: string;
  userId: string;
  email: string;
  planType: PlanType;
  amountCentavos: number;
  expiresAt: Date;
}): Promise<{ preferenceId: string; initPoint: string }> {
  await assertPixAvailable();

  const returnUrl = getCheckoutReturnBaseUrl();
  const response = await fetch(
    "https://api.mercadopago.com/checkout/preferences",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getAccessToken()}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": linkId,
      },
      body: JSON.stringify({
        items: [
          {
            id: `automatize-${planType}`,
            title: `Automatize ${PLAN_DEFINITIONS[planType].name}`,
            quantity: 1,
            unit_price: toBRLUnitAmount(amountCentavos),
            currency_id: "BRL",
          },
        ],
        payer: { email },
        external_reference: linkId,
        notification_url: getMercadoPagoWebhookUrl(),
        date_of_expiration: expiresAt.toISOString(),
        back_urls: {
          success: `${returnUrl}/app/assinatura?pix_status=success`,
          failure: `${returnUrl}/app/assinatura?pix_status=failure`,
          pending: `${returnUrl}/app/assinatura?pix_status=pending`,
        },
        auto_return: "approved",
        metadata: {
          payment_link_id: linkId,
          user_id: userId,
          plan_type: planType,
          amount_centavos: amountCentavos,
          source: "backoffice",
        },
        payment_methods: {
          excluded_payment_methods: [
            { id: "visa" },
            { id: "master" },
            { id: "amex" },
            { id: "elo" },
            { id: "hipercard" },
            { id: "debvisa" },
            { id: "debmaster" },
            { id: "bolbradesco" },
            { id: "pec" },
            { id: "debelo" },
            { id: "atm" },
            { id: "paypalec" },
          ],
          excluded_payment_types: [
            { id: "ticket" },
            { id: "atm" },
            { id: "credit_card" },
            { id: "debit_card" },
            { id: "paypalec" },
          ],
          default_payment_method_id: "pix",
          installments: 1,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const preference = (await response.json()) as {
    id?: string;
    init_point?: string;
    sandbox_init_point?: string;
  };
  const preferenceId = preference.id;
  const initPoint = preference.init_point ?? preference.sandbox_init_point;
  if (!preferenceId || !initPoint) {
    throw new Error("Mercado Pago preference response is missing checkout URL");
  }
  return { preferenceId, initPoint };
}

export async function createOrReuseBackofficePixLink({
  userId,
  planType,
  adminEmail,
}: {
  userId: string;
  planType: PlanType;
  adminEmail: string;
}): Promise<MercadoPagoPaymentLink & { reused: boolean }> {
  const activeSubscriptions = await db
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.userId, userId),
        inArray(subscription.status, ["active", "trialing", "past_due"]),
      ),
    );

  const hasStripeBlock = activeSubscriptions.some(
    (sub) =>
      (sub.provider ?? "stripe") === "stripe" &&
      ["active", "trialing", "past_due"].includes(sub.status),
  );
  if (hasStripeBlock) {
    throw new Error("Usuário tem assinatura Stripe ativa.");
  }

  await assertPixAvailable();

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

  if (existing) return { ...existing, reused: true };

  const [targetUser] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!targetUser) throw new Error("Usuário não encontrado.");

  const id = randomUUID();
  const expiresAt = addDays(now, PIX_LINK_VALIDITY_DAYS);
  const preference = await createPreference({
    linkId: id,
    userId,
    email: targetUser.email,
    planType,
    amountCentavos: amount,
    expiresAt,
  });

  const [created] = await db
    .insert(mercadopagoPaymentLink)
    .values({
      id,
      userId,
      planType,
      amount,
      currency: "brl",
      preferenceId: preference.preferenceId,
      initPoint: preference.initPoint,
      status: "pending",
      source: "backoffice",
      adminEmail,
      expiresAt,
    })
    .returning();

  if (!created) throw new Error("Falha ao salvar link Pix.");
  return { ...created, reused: false };
}

export async function sendBackofficePixLinkEmail({
  to,
  name,
  link,
}: {
  to: string;
  name: string;
  link: MercadoPagoPaymentLink;
}) {
  const plan = PLAN_DEFINITIONS[link.planType];
  const months = getPixCommitmentMonths(link.planType);
  const expiresAt = link.expiresAt.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });

  const { error } = await resend.emails.send(
    {
      from: getFromAddress(),
      to: [to],
      subject: `Link Pix para assinar ${plan.name}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
          <p>Olá, ${name}.</p>
          <p>Segue o link para pagar o plano <strong>${plan.name}</strong> via Pix pelo Mercado Pago.</p>
          <p>Período contratado: ${months} ${months === 1 ? "mês" : "meses"}.</p>
          <p><a href="${link.initPoint}" style="display:inline-block;background:#4C49BE;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Pagar com Pix</a></p>
          <p style="font-size:12px;color:#666">O link vence em ${expiresAt}.</p>
        </div>
      `,
      text: `Olá, ${name}. Pague o plano ${plan.name} via Pix pelo Mercado Pago: ${link.initPoint}. O link vence em ${expiresAt}.`,
    },
    { idempotencyKey: `backoffice-pix-link:${link.id}` },
  );

  if (error) throw new Error(error.message);
}
