// Saque do afiliado — a parte da regra que a operação precisa (ticket 11).
//
// A máquina de estados é **espelhada** em
// `automatize-frontend/lib/referral/payout.ts`: o afiliado abre o pedido lá, o
// administrador o move daqui, e os dois lados precisam concordar sobre quais
// movimentos existem. As duas cópias têm teste próprio, e é a igualdade entre
// elas que este comentário protege.
//
// O que NÃO está aqui: as pré-condições do pedido (saldo, mínimo, documento).
// Elas só fazem sentido no lado que cria o pedido, e duplicá-las aqui criaria
// uma segunda opinião sobre quando um saque pode nascer.

import type {
  ReferralPayoutStatus,
  ReferralTaxDocumentType,
} from "@/lib/db/schema";

/**
 * As transições que existem. `pago`, `negado` e `cancelado` são terminais: um
 * saque pago já virou lançamento no ledger, e o ledger é imutável.
 *
 * Ninguém pula a aprovação — é ela que declara que alguém olhou o pedido antes
 * de o dinheiro sair.
 */
export const REFERRAL_PAYOUT_TRANSITIONS: Record<
  ReferralPayoutStatus,
  readonly ReferralPayoutStatus[]
> = {
  requested: ["approved", "denied", "cancelled"],
  approved: ["paid", "denied", "cancelled"],
  paid: [],
  denied: [],
  cancelled: [],
};

/**
 * A transição é permitida? Repetir o estado atual NÃO é transição: marcar como
 * pago um pedido já pago é um segundo repasse sendo pedido, e a resposta
 * precisa dizer isso.
 */
export function canTransitionReferralPayout(
  from: ReferralPayoutStatus,
  to: ReferralPayoutStatus,
): boolean {
  return REFERRAL_PAYOUT_TRANSITIONS[from].includes(to);
}

/** Os cinco estados do saque, em português. */
export const REFERRAL_PAYOUT_STATUS_LABELS: Record<
  ReferralPayoutStatus,
  string
> = {
  requested: "Solicitado",
  approved: "Aprovado",
  paid: "Pago",
  denied: "Negado",
  cancelled: "Cancelado",
};

/** Um pedido aberto trava o próximo: é o que o índice único parcial cobre. */
export const OPEN_REFERRAL_PAYOUT_STATUSES = [
  "requested",
  "approved",
] as const satisfies readonly ReferralPayoutStatus[];

export function isOpenReferralPayoutStatus(
  status: ReferralPayoutStatus,
): boolean {
  return (OPEN_REFERRAL_PAYOUT_STATUSES as readonly string[]).includes(status);
}

/**
 * `12345678909` → `123.456.789-09`. Só apresentação — o que o operador vê ao
 * conferir a chave Pix contra o titular exibido pelo banco.
 */
export function formatTaxDocument(
  document: string,
  type: ReferralTaxDocumentType,
): string {
  if (type === "cpf" && document.length === 11) {
    return document.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  if (type === "cnpj" && document.length === 14) {
    return document.replace(
      /^(.{2})(.{3})(.{3})(.{4})(.{2})$/,
      "$1.$2.$3/$4-$5",
    );
  }
  return document;
}
