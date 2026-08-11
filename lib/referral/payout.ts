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

// ---------- validação do documento ----------
//
// Portada de `automatize-frontend/lib/referral/payout.ts`, onde o afiliado
// grava o documento no primeiro saque. Aqui ela serve à correção
// administrativa: o afiliado NÃO consegue trocar o próprio documento — só um
// administrador, por esta validação.

export type ReferralTaxDocument = {
  document: string;
  type: ReferralTaxDocumentType;
};

export type TaxDocumentParseResult =
  | ({ ok: true } & ReferralTaxDocument)
  | { ok: false; message: string };

/** Dígito verificador por soma ponderada, módulo 11 — CPF e CNPJ usam a mesma. */
function checkDigit(
  values: readonly number[],
  weights: readonly number[],
): number {
  const sum = values.reduce(
    (total, value, index) => total + value * weights[index],
    0,
  );
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function isValidCpf(digits: string): boolean {
  // 11111111111 passa na conta do módulo 11 e não é documento de ninguém.
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const values = [...digits].map(Number);
  const first = checkDigit(values.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(
    values.slice(0, 10),
    [11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  return values[9] === first && values[10] === second;
}

const CNPJ_FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_SECOND_WEIGHTS = [6, ...CNPJ_FIRST_WEIGHTS];

/**
 * CNPJ, incluindo o alfanumérico. Desde 2026 a base pode conter letras nas doze
 * primeiras posições; o cálculo do dígito usa o valor ASCII menos 48, que para
 * um algarismo devolve o próprio número — o mesmo código serve para os dois
 * formatos. Os dois dígitos verificadores continuam sendo sempre numéricos.
 */
function isValidCnpj(raw: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(raw)) return false;
  if (/^(.)\1{13}$/.test(raw)) return false;

  const values = [...raw].map((char) => char.charCodeAt(0) - 48);
  const first = checkDigit(values.slice(0, 12), CNPJ_FIRST_WEIGHTS);
  const second = checkDigit(values.slice(0, 13), CNPJ_SECOND_WEIGHTS);
  return values[12] === first && values[13] === second;
}

/**
 * Lê o documento digitado e devolve sem pontuação, já com o tipo. Onze
 * caracteres são CPF; catorze, CNPJ. Qualquer outra coisa é recusada com uma
 * mensagem que diz o que fazer.
 */
export function parseTaxDocument(raw: string | null): TaxDocumentParseResult {
  const cleaned = (raw ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

  if (cleaned.length === 0) {
    return { ok: false, message: "Informe o CPF ou CNPJ." };
  }
  if (cleaned.length === 11) {
    if (!/^\d{11}$/.test(cleaned) || !isValidCpf(cleaned)) {
      return { ok: false, message: "CPF inválido — confira os números." };
    }
    return { ok: true, document: cleaned, type: "cpf" };
  }
  if (cleaned.length === 14) {
    if (!isValidCnpj(cleaned)) {
      return { ok: false, message: "CNPJ inválido — confira os caracteres." };
    }
    return { ok: true, document: cleaned, type: "cnpj" };
  }

  return {
    ok: false,
    message: "O documento precisa ter 11 dígitos (CPF) ou 14 (CNPJ).",
  };
}
