/**
 * Quem é cliente ativo na área de Tráfego. O critério é o acesso de fato
 * (`users.expiration_date`), não o status da assinatura sozinho: o status do
 * Mercado Pago fica `active` depois que a cobrança para, e `past_due` da Stripe
 * sobra por meses. Puro, sem banco.
 *
 * - pagante: assinatura ativa e acesso válido — o número que o time usa.
 * - trial: em teste, acesso válido.
 * - cancelado: cancelou, ainda dentro do período pago.
 * - inadimplente: cobrança falhou (past_due) e o acesso venceu há no máximo
 *   PAST_DUE_GRACE_DAYS dias — a Stripe ainda está tentando cobrar.
 * - manual: acesso liberado à mão, sem assinatura viva.
 * - expirado: acesso venceu há no máximo EXPIRED_WINDOW_DAYS dias (e não é
 *   inadimplente na tolerância). Só o CRM mostra — é a fila de reativação do Gui.
 */

export type AccessSegment = "pagante" | "trial" | "cancelado" | "inadimplente" | "manual" | "expirado";

/** Até quantos dias depois do vencimento um past_due ainda aparece (como inadimplente). */
export const PAST_DUE_GRACE_DAYS = 15;

/** Até quantos dias depois do vencimento o cliente segue no CRM, como expirado. */
export const EXPIRED_WINDOW_DAYS = 60;

/** O universo principal: "Todos ativos", resumo por plano, Precisa de você, Jornada e MCP. */
export const CORE_SEGMENTS: readonly AccessSegment[] = ["pagante"];

export const ACCESS_LABEL: Record<AccessSegment, string> = {
  pagante: "Pagante",
  trial: "Trial",
  cancelado: "Cancelado (com acesso)",
  inadimplente: "Pagamento atrasado",
  manual: "Acesso manual",
  expirado: "Expirado",
};

const DAY = 86_400_000;

export function accessSegmentOf(
  input: { status: string | null; accessUntil: string | Date | null },
  now: number = Date.now(),
): AccessSegment | null {
  const until = input.accessUntil == null ? null : new Date(input.accessUntil).getTime();
  const valid = until != null && until > now;
  if (input.status === "past_due" && until != null && until > now - PAST_DUE_GRACE_DAYS * DAY) return "inadimplente";
  if (!valid) return until != null && until > now - EXPIRED_WINDOW_DAYS * DAY ? "expirado" : null;
  if (input.status === "active") return "pagante";
  if (input.status === "trialing") return "trial";
  if (input.status === "canceled") return "cancelado";
  return "manual";
}

export function isCoreSegment(segment: AccessSegment) {
  return CORE_SEGMENTS.includes(segment);
}
