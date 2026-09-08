/**
 * Regras da recuperação de venda por Pix — sem I/O, para dar para testar.
 *
 * Contexto: quando um Pix de infoproduto vence, o Mercado Pago manda
 * `cancelled` e o webhook marca o pedido inteiro como `failed`
 * (lib/products/process-payment.ts no app). Esse pedido é uma venda perdida com
 * intenção declarada, e o vendedor recupera no WhatsApp mandando um Pix novo.
 */

/** O Pix gerado pelo admin vale 24h — prazo de uma conversa de WhatsApp. */
export const RECOVERY_PIX_VALIDITY_HOURS = 24;

/**
 * Carimbo da geração fica em `product_orders.attribution` (jsonb) em vez de
 * colunas novas. Não é preguiça: migração aqui é risco desproporcional para
 * quatro campos de UI, e a coluna já é usada como carimbo em outros pontos do
 * fluxo (origem da conta do comprador, ids dos order bumps).
 */
export const RECOVERY_PIX_KEYS = {
  generatedAt: "recovery_pix_generated_at",
  expiresAt: "recovery_pix_expires_at",
  admin: "recovery_pix_admin",
  attempts: "recovery_pix_attempts",
} as const;

export type RecoveryPixStamp = {
  generatedAt: Date;
  expiresAt: Date;
  adminEmail: string | null;
  attempts: number;
};

type Attribution = Record<string, string | null> | null | undefined;

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function readRecoveryPixStamp(
  attribution: Attribution,
): RecoveryPixStamp | null {
  const generatedAt = parseDate(attribution?.[RECOVERY_PIX_KEYS.generatedAt]);
  const expiresAt = parseDate(attribution?.[RECOVERY_PIX_KEYS.expiresAt]);
  if (!generatedAt || !expiresAt) return null;

  const rawAttempts = Number(attribution?.[RECOVERY_PIX_KEYS.attempts] ?? "1");
  return {
    generatedAt,
    expiresAt,
    adminEmail: attribution?.[RECOVERY_PIX_KEYS.admin] ?? null,
    attempts: Number.isInteger(rawAttempts) && rawAttempts > 0 ? rawAttempts : 1,
  };
}

export function writeRecoveryPixStamp(
  attribution: Attribution,
  stamp: { generatedAt: Date; expiresAt: Date; adminEmail: string; attempts: number },
): Record<string, string | null> {
  return {
    ...(attribution ?? {}),
    [RECOVERY_PIX_KEYS.generatedAt]: stamp.generatedAt.toISOString(),
    [RECOVERY_PIX_KEYS.expiresAt]: stamp.expiresAt.toISOString(),
    [RECOVERY_PIX_KEYS.admin]: stamp.adminEmail,
    [RECOVERY_PIX_KEYS.attempts]: String(stamp.attempts),
  };
}

export type RecoveryOrderInput = {
  orderStatus: string;
  paymentStatus: string | null;
  paymentRawStatus: string | null;
  paymentMethodId: string | null;
  attribution: Attribution;
};

export type RecoveryPixState =
  /** Pix vencido: é a fila de trabalho do vendedor. */
  | { kind: "expired" }
  /** O admin já gerou um Pix e ele ainda vale — não mande outro. */
  | { kind: "active"; stamp: RecoveryPixStamp }
  /** Já pagou. */
  | { kind: "settled" }
  /** Não é caso de recuperação por Pix (cartão recusado, estorno, etc.). */
  | { kind: "not_applicable" };

/**
 * Estado de recuperação de um pedido.
 *
 * `active` vence `expired` de propósito: o pedido continua na lista depois que
 * o admin gera o código, marcado, para o vendedor não abordar a mesma pessoa
 * duas vezes. Quando as 24h passam, ele volta sozinho para `expired`.
 */
export function resolveRecoveryPixState(
  order: RecoveryOrderInput,
  now: Date,
): RecoveryPixState {
  if (order.orderStatus === "approved") return { kind: "settled" };
  if (order.orderStatus === "refunded") return { kind: "not_applicable" };

  const stamp = readRecoveryPixStamp(order.attribution);
  if (
    stamp &&
    stamp.expiresAt.getTime() > now.getTime() &&
    order.orderStatus === "pending"
  ) {
    return { kind: "active", stamp };
  }

  if (isExpiredPixPayment(order)) return { kind: "expired" };
  return { kind: "not_applicable" };
}

/**
 * "Deixou o Pix vencer" = pedido derrubado por uma cobrança Pix cancelada.
 *
 * Conferido contra a produção em 08/09/2026: todo Pix vencido chega aqui como
 * `failed`/`cancelled`, e não havia nenhum pedido preso em `pending` além da
 * janela — o webhook da MP dá conta. Por isso a regra olha o estado final e não
 * precisa adivinhar vencimento por tempo decorrido.
 */
export function isExpiredPixPayment(order: RecoveryOrderInput): boolean {
  return (
    order.orderStatus === "failed" &&
    order.paymentStatus === "failed" &&
    order.paymentRawStatus === "cancelled" &&
    order.paymentMethodId === "pix"
  );
}

export type RecoveryPixRefusal =
  | "already_paid"
  | "refunded"
  | "not_expired_pix"
  | "buyer_has_open_order";

export const RECOVERY_PIX_REFUSAL_COPY: Record<RecoveryPixRefusal, string> = {
  already_paid: "Este pedido já foi pago.",
  refunded: "Este pedido foi estornado.",
  not_expired_pix:
    "Este pedido não é um Pix vencido — a recuperação só vale para quem gerou o código e deixou vencer.",
  buyer_has_open_order:
    "O cliente já tem outra compra aberta ou paga deste produto. Reabrir este pedido esbarraria na trava de uma compra por produto e e-mail.",
};

/**
 * Decide se dá para gerar (ou reaproveitar) um Pix de recuperação.
 *
 * `buyerHasOtherOpenOrder` existe por causa do índice único parcial
 * `product_orders_one_open_purchase` em (product_id, buyer_email) para status
 * `pending`/`approved`: se o cliente voltou ao site e abriu outra compra do
 * mesmo produto depois que esta venceu, reabrir esta aqui violaria o índice. É
 * melhor recusar com motivo do que estourar no banco.
 */
export function evaluateRecoveryPix(
  order: RecoveryOrderInput,
  { now, buyerHasOtherOpenOrder }: { now: Date; buyerHasOtherOpenOrder: boolean },
):
  | { ok: true; action: "create" }
  | { ok: true; action: "reuse"; stamp: RecoveryPixStamp }
  | { ok: false; reason: RecoveryPixRefusal } {
  const state = resolveRecoveryPixState(order, now);

  if (state.kind === "settled") return { ok: false, reason: "already_paid" };
  if (state.kind === "active") return { ok: true, action: "reuse", stamp: state.stamp };
  if (state.kind === "not_applicable") {
    if (order.orderStatus === "refunded") return { ok: false, reason: "refunded" };
    return { ok: false, reason: "not_expired_pix" };
  }

  if (buyerHasOtherOpenOrder) {
    return { ok: false, reason: "buyer_has_open_order" };
  }
  return { ok: true, action: "create" };
}

export function recoveryPixExpiresAt(now: Date): Date {
  return new Date(now.getTime() + RECOVERY_PIX_VALIDITY_HOURS * 60 * 60 * 1000);
}

/** Igual ao do app (lib/products/order-bumps-shared.ts). */
const MAX_ORDER_BUMPS = 5;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Lê os ids dos order bumps do carimbo de atribuição.
 *
 * Reimplementado aqui porque o backoffice não espelha `order-bumps-shared.ts`.
 * A semântica precisa bater com a do app: é o mesmo campo que volta no
 * `metadata.order_bump_order_ids` da cobrança e que o webhook reprocessa. Uma
 * lista maior que o teto vira lista vazia lá, então vira aqui também — assim o
 * grupo que eu reabro é exatamente o grupo que a aprovação vai enxergar.
 */
export function parseOrderBumpOrderIds(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  const parsed = value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (parsed.length > MAX_ORDER_BUMPS) return [];
  if (!parsed.every((id) => UUID_RE.test(id))) return [];
  return [...new Set(parsed)];
}
