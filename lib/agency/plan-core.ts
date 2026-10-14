import type Stripe from "stripe";

/**
 * Regras puras do Plano da Agência (ADR 0046): a agência paga pelo Stripe um preço por cliente ×
 * quantidade; a quantidade limita os clientes ligados e o "pago até" (+ carência) cobre o acesso
 * das contas deles. Sem IO, para testar sem banco nem Stripe.
 */

/** Dias além do período pago: cobre as novas tentativas do Stripe quando o cartão recusa. */
export const PLAN_GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_PLAN_CLIENTS = 500;
export const MIN_UNIT_AMOUNT_CENTS = 100;

export type PlanStatus = "none" | "pending" | "active" | "past_due" | "canceled";

/** Status do Stripe → status do plano. Acesso nunca sai do status, só do "pago até". */
export function planStatusFromStripe(status: string): PlanStatus {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "incomplete" || status === "paused") return "pending";
  return "canceled";
}

/** Até quando as contas dos clientes ficam cobertas: o período pago mais a carência. */
export function coverageUntil(paidUntil: Date | null): Date | null {
  return paidUntil ? new Date(paidUntil.getTime() + PLAN_GRACE_DAYS * DAY_MS) : null;
}

export function planCovers(paidUntil: Date | null, now = new Date()): boolean {
  const until = coverageUntil(paidUntil);
  return until !== null && until.getTime() > now.getTime();
}

/** Por que a agência não pode ligar mais um cliente, ou null se pode. */
export function seatRefusal(clientLimit: number, linked: number): string | null {
  if (clientLimit <= 0) return "A agência ainda não tem plano. Defina o plano antes de ligar clientes.";
  if (linked >= clientLimit) {
    return `O plano cobre ${clientLimit} ${clientLimit === 1 ? "cliente" : "clientes"} e todos estão em uso. Aumente o plano para ligar mais.`;
  }
  return null;
}

export type PlanInput = { unitAmountCents: number; clientLimit: number };

/** Lê o formulário do admin: preço por cliente em reais ("249,90") e quantidade de clientes. */
export function parsePlanInput(raw: { unitAmount?: unknown; clientLimit?: unknown }): PlanInput | { error: string } {
  const text = typeof raw.unitAmount === "number" ? String(raw.unitAmount) : typeof raw.unitAmount === "string" ? raw.unitAmount : "";
  const normalized = text.trim().replace(/^R\$\s*/i, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const reais = /^\d+(\.\d{1,2})?$/.test(normalized) ? Number(normalized) : Number.NaN;
  const unitAmountCents = Math.round(reais * 100);
  if (!Number.isFinite(reais) || unitAmountCents < MIN_UNIT_AMOUNT_CENTS) return { error: "Informe o preço por cliente (a partir de R$ 1,00)." };
  const clientLimit = typeof raw.clientLimit === "number" ? raw.clientLimit : Number(typeof raw.clientLimit === "string" ? raw.clientLimit.trim() : Number.NaN);
  if (!Number.isInteger(clientLimit) || clientLimit < 1 || clientLimit > MAX_PLAN_CLIENTS) {
    return { error: `Informe quantos clientes o plano cobre (de 1 a ${MAX_PLAN_CLIENTS}).` };
  }
  return { unitAmountCents, clientLimit };
}

export const formatBRL = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Assinatura que ainda cobra (ativa ou com pagamento atrasado): não abre outro checkout. */
export const isLiveSubscription = (status: string) => status === "active" || status === "past_due";

const resourceId = (value: string | { id?: string | null } | null | undefined) => (typeof value === "string" ? value : (value?.id ?? null));

export type SubscriptionSnapshot = {
  agencyId: string;
  subscriptionId: string;
  customerId: string | null;
  status: PlanStatus;
  clientLimit: number;
  unitAmountCents: number | null;
  itemId: string | null;
  productId: string | null;
};

type SubscriptionLike = Pick<Stripe.Subscription, "id" | "status" | "metadata" | "customer"> & {
  items: { data: Array<Pick<Stripe.SubscriptionItem, "id" | "quantity"> & { price: Pick<Stripe.Price, "unit_amount" | "product"> }> };
};

/** Estado da assinatura de uma agência, ou null se a assinatura não é de agência. */
export function snapshotFromSubscription(subscription: SubscriptionLike): SubscriptionSnapshot | null {
  const agencyId = subscription.metadata?.agency_id;
  if (!agencyId) return null;
  const item = subscription.items.data[0];
  return {
    agencyId,
    subscriptionId: subscription.id,
    customerId: resourceId(subscription.customer),
    status: planStatusFromStripe(subscription.status),
    clientLimit: item?.quantity ?? 0,
    unitAmountCents: item?.price.unit_amount ?? null,
    itemId: item?.id ?? null,
    productId: resourceId(item?.price.product as string | { id?: string } | null | undefined),
  };
}

type InvoiceLike = Pick<Stripe.Invoice, "parent"> & { lines: { data: Array<{ period: { end: number } }> } };

/** Agência e assinatura de uma fatura, pela cópia dos metadados da assinatura que a fatura guarda. */
export function agencyInvoice(invoice: InvoiceLike): { agencyId: string; subscriptionId: string } | null {
  const details = invoice.parent?.type === "subscription_details" ? invoice.parent.subscription_details : null;
  const agencyId = details?.metadata?.agency_id;
  const subscriptionId = resourceId(details?.subscription);
  return agencyId && subscriptionId ? { agencyId, subscriptionId } : null;
}

/** Fim do período que a fatura pagou (o maior entre as linhas, incluindo ajustes proporcionais). */
export function paidPeriodEnd(invoice: InvoiceLike): Date | null {
  const end = Math.max(0, ...invoice.lines.data.map((line) => line.period.end));
  return end > 0 ? new Date(end * 1000) : null;
}
