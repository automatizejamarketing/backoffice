import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { hasBackofficePermission, type BackofficeActor } from "@/lib/auth/rbac-core";
import { db } from "@/lib/db";
import { agency, agencyClient, backofficeUser } from "@/lib/db/schema";
import { stripe } from "@/lib/stripe";
import { AgencyError, assertManage } from "./agencies";
import { applyAgencyCoverage } from "./coverage";
import { agencyInvoice, isLiveSubscription, paidPeriodEnd, parsePlanInput, snapshotFromSubscription, type SubscriptionSnapshot } from "./plan-core";

/**
 * Plano da Agência no Stripe (ADR 0046). O admin define preço por cliente e quantidade; o Dono paga
 * pelo checkout do Stripe; o webhook `/api/stripe/agency-webhook` guarda o status e o "pago até" e
 * estende o acesso das contas dos clientes. O webhook do frontend ignora estas assinaturas (sem
 * `app_user_id`).
 */

const WEBHOOK_ACTOR = "stripe:plano-agencia";

function requireStripe() {
  if (!stripe) throw new AgencyError("O Stripe não está configurado neste ambiente.", 409);
  return stripe;
}

/**
 * Admin define (ou muda) o plano. Com assinatura viva, muda no Stripe (a diferença entra na próxima
 * fatura). A agência fica travada enquanto isso: ninguém liga cliente no meio da troca.
 */
export async function setAgencyPlan(actor: BackofficeActor, agencyId: string, raw: Record<string, unknown>) {
  assertManage(actor, agencyId);
  if (!hasBackofficePermission(actor, "team:manage")) throw new AgencyError("Só a Automatize define o plano da agência.", 403);
  const input = parsePlanInput(raw);
  if ("error" in input) throw new AgencyError(input.error);

  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(agency).where(eq(agency.id, agencyId)).for("update").limit(1);
    if (!row) throw new AgencyError("Agência não encontrada.", 404);
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(agencyClient).where(eq(agencyClient.agencyId, agencyId));
    if (input.clientLimit < count) {
      throw new AgencyError(`A agência já tem ${count} clientes. Tire clientes antes de baixar o plano para ${input.clientLimit}.`, 409);
    }

    if (row.stripeSubscriptionId && isLiveSubscription(row.planStatus)) {
      const client = requireStripe();
      const snapshot = snapshotFromSubscription(await client.subscriptions.retrieve(row.stripeSubscriptionId));
      if (!snapshot?.itemId || !snapshot.productId) throw new AgencyError("A assinatura da agência no Stripe está sem item.", 409);
      const priceChanged = snapshot.unitAmountCents !== input.unitAmountCents;
      await client.subscriptions.update(row.stripeSubscriptionId, {
        items: [
          {
            id: snapshot.itemId,
            quantity: input.clientLimit,
            ...(priceChanged
              ? { price_data: { currency: "brl", product: snapshot.productId, unit_amount: input.unitAmountCents, recurring: { interval: "month" as const } } }
              : {}),
          },
        ],
        proration_behavior: "create_prorations",
      });
    }

    await tx
      .update(agency)
      .set({ planClientLimit: input.clientLimit, planUnitAmountCents: input.unitAmountCents, planStatus: row.planStatus === "none" ? "pending" : row.planStatus })
      .where(eq(agency.id, agencyId));
  });
}

/**
 * Para o Dono (ou o admin) pagar: o checkout do Stripe quando não há assinatura que cobre, ou a
 * fatura em aberto quando o pagamento atrasou. Devolve a URL.
 */
export async function agencyPaymentUrl(actor: BackofficeActor, agencyId: string, origin: string): Promise<string> {
  assertManage(actor, agencyId);
  const [row] = await db.select().from(agency).where(eq(agency.id, agencyId)).limit(1);
  if (!row) throw new AgencyError("Agência não encontrada.", 404);
  const client = requireStripe();

  if (row.stripeSubscriptionId && row.planStatus === "past_due") {
    const subscription = await client.subscriptions.retrieve(row.stripeSubscriptionId, { expand: ["latest_invoice"] });
    const invoice = subscription.latest_invoice;
    if (invoice && typeof invoice !== "string" && invoice.status === "open" && invoice.hosted_invoice_url) return invoice.hosted_invoice_url;
  }
  if (row.stripeSubscriptionId && isLiveSubscription(row.planStatus)) throw new AgencyError("O plano desta agência já está pago.", 409);
  if (!row.planUnitAmountCents || row.planClientLimit < 1) throw new AgencyError("A Automatize ainda não definiu o plano desta agência.", 409);

  let customerId = row.stripeCustomerId;
  if (!customerId) {
    const [owner] = await db
      .select({ email: backofficeUser.email })
      .from(backofficeUser)
      .where(and(eq(backofficeUser.agencyId, agencyId), eq(backofficeUser.role, "agency_owner")))
      .orderBy(asc(backofficeUser.createdAt))
      .limit(1);
    const customer = await client.customers.create(
      { name: row.name, email: owner?.email ?? actor.email, metadata: { agency_id: agencyId } },
      { idempotencyKey: `agency-customer:${agencyId}` },
    );
    customerId = customer.id;
    await db.update(agency).set({ stripeCustomerId: customerId }).where(eq(agency.id, agencyId));
  }

  const base = `${origin.replace(/\/$/, "")}/agencias/${agencyId}`;
  const session = await client.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: agencyId,
    locale: "pt-BR",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "brl",
          product_data: { name: `Plano Agência: ${row.name}` },
          unit_amount: row.planUnitAmountCents,
          recurring: { interval: "month" },
        },
        quantity: row.planClientLimit,
      },
    ],
    metadata: { agency_id: agencyId },
    subscription_data: { metadata: { agency_id: agencyId } },
    success_url: `${base}?plano=pago`,
    cancel_url: base,
  });
  if (!session.url) throw new AgencyError("O Stripe não devolveu o link de pagamento. Tente de novo.", 409);
  return session.url;
}

/**
 * Guarda o estado da assinatura na agência. Um evento atrasado de uma assinatura antiga e já morta
 * não sobrescreve a assinatura atual.
 */
async function storeSnapshot(snapshot: SubscriptionSnapshot) {
  const live = isLiveSubscription(snapshot.status);
  await db
    .update(agency)
    .set({
      stripeSubscriptionId: snapshot.subscriptionId,
      stripeCustomerId: snapshot.customerId,
      planStatus: snapshot.status,
      ...(live ? { planClientLimit: snapshot.clientLimit, planUnitAmountCents: snapshot.unitAmountCents } : {}),
    })
    .where(
      and(
        eq(agency.id, snapshot.agencyId),
        live ? undefined : sql`(${agency.stripeSubscriptionId} IS NULL OR ${agency.stripeSubscriptionId} = ${snapshot.subscriptionId})`,
      ),
    );
}

/** Relê a assinatura no Stripe (fonte da verdade, à prova de evento fora de ordem) e guarda. */
export async function syncAgencySubscription(subscriptionId: string) {
  const snapshot = snapshotFromSubscription(await requireStripe().subscriptions.retrieve(subscriptionId));
  if (snapshot) await storeSnapshot(snapshot);
  return snapshot;
}

/** Fatura paga: o "pago até" avança (nunca volta) e as contas dos clientes ganham acesso até lá + carência. */
export async function recordAgencyInvoicePaid(invoice: Parameters<typeof agencyInvoice>[0]) {
  const target = agencyInvoice(invoice);
  if (!target) return false;
  const periodEnd = paidPeriodEnd(invoice);
  if (periodEnd) {
    const end = periodEnd.toISOString();
    await db.transaction(async (tx) => {
      await tx
        .update(agency)
        .set({ planPaidUntil: sql`greatest(coalesce(${agency.planPaidUntil}, ${end}::timestamptz), ${end}::timestamptz)` })
        .where(eq(agency.id, target.agencyId));
      await applyAgencyCoverage(tx, target.agencyId, WEBHOOK_ACTOR);
    });
  }
  await syncAgencySubscription(target.subscriptionId);
  return true;
}

/** Eventos do Stripe que mexem no plano. Os demais (e os que não são de agência) passam reto. */
export async function handleAgencyStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "invoice.paid":
      await recordAgencyInvoicePaid(event.data.object);
      return;
    case "checkout.session.completed": {
      const session = event.data.object;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (session.mode === "subscription" && session.metadata?.agency_id && subscriptionId) await syncAgencySubscription(subscriptionId);
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      if (event.data.object.metadata?.agency_id) await syncAgencySubscription(event.data.object.id);
      return;
    default:
      return;
  }
}
