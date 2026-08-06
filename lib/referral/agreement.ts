// Acordo de Comissão — o que o administrador escolhe ao aprovar um afiliado.
//
// O acordo tem exatamente três coisas: formato (percentual ou valor fixo),
// valor e duração (vitalícia, N ciclos ou primeira venda). Carência e base de
// cálculo NÃO entram aqui: são globais ao programa e vivem em
// `referral_program_config` (spec 0024, ADR 0026).
//
// Este módulo é uma função pura — sem rede, sem banco. Ele repete, em
// TypeScript, as duas restrições que o Postgres já garante
// (`referral_agreements_format_value` e `referral_agreements_duration_cycles`),
// não para ser o dono da regra, mas para que o operador receba uma mensagem
// legível em vez de um erro 23514.
//
// Módulo espelhado byte a byte em `automatize-frontend/lib/referral/
// agreement.ts` e `backoffice/lib/referral/agreement.ts`: o backoffice escreve
// o acordo, o painel do afiliado o exibe, e os dois precisam descrevê-lo com
// as mesmas palavras.

import type {
  ReferralAgreementDuration,
  ReferralAgreementFormat,
} from "@/lib/db/schema";

/** Os termos do acordo, já validados. Dinheiro sempre em centavos. */
export type ReferralAgreementTerms = {
  format: ReferralAgreementFormat;
  percentageBps: number | null;
  fixedAmountCentavos: number | null;
  duration: ReferralAgreementDuration;
  durationCycles: number | null;
};

export type ReferralAgreementTermsInput = {
  format?: unknown;
  percentageBps?: unknown;
  fixedAmountCentavos?: unknown;
  duration?: unknown;
  durationCycles?: unknown;
};

export type ParsedAgreementTerms =
  | { ok: true; terms: ReferralAgreementTerms }
  | { ok: false; error: string };

const FORMATS = ["percentage", "fixed"] as const satisfies
  readonly ReferralAgreementFormat[];

const DURATIONS = ["lifetime", "n_cycles", "first_sale"] as const satisfies
  readonly ReferralAgreementDuration[];

// 100% em basis points. Um acordo de 100% do líquido é absurdo, mas é o teto
// aritmético; travar abaixo disso seria inventar uma política de negócio que
// ninguém decidiu.
const MAX_PERCENTAGE_BPS = 10_000;
// R$ 10.000,00 por fatura comissionada. Existe para transformar um erro de
// digitação (centavos digitados como reais) em mensagem, não em passivo.
const MAX_FIXED_AMOUNT_CENTAVOS = 1_000_000;
const MAX_DURATION_CYCLES = 120;

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Valida os termos vindos da interface administrativa. Devolve o motivo em
 * português — é o que o operador lê quando erra o formulário.
 */
export function parseAgreementTerms(
  input: ReferralAgreementTermsInput,
): ParsedAgreementTerms {
  const format = input.format;
  if (typeof format !== "string" || !FORMATS.includes(format as never)) {
    return { ok: false, error: "Formato do acordo inválido" };
  }

  const duration = input.duration;
  if (typeof duration !== "string" || !DURATIONS.includes(duration as never)) {
    return { ok: false, error: "Duração do acordo inválida" };
  }

  let percentageBps: number | null = null;
  let fixedAmountCentavos: number | null = null;

  if (format === "percentage") {
    if (!isInteger(input.percentageBps)) {
      return {
        ok: false,
        error: "Informe o percentual da comissão",
      };
    }
    if (input.percentageBps < 1 || input.percentageBps > MAX_PERCENTAGE_BPS) {
      return {
        ok: false,
        error: "O percentual precisa estar entre 0,01% e 100%",
      };
    }
    percentageBps = input.percentageBps;
  } else {
    if (!isInteger(input.fixedAmountCentavos)) {
      return { ok: false, error: "Informe o valor fixo da comissão" };
    }
    if (
      input.fixedAmountCentavos < 1 ||
      input.fixedAmountCentavos > MAX_FIXED_AMOUNT_CENTAVOS
    ) {
      return {
        ok: false,
        error: "O valor fixo precisa estar entre R$ 0,01 e R$ 10.000,00",
      };
    }
    fixedAmountCentavos = input.fixedAmountCentavos;
  }

  let durationCycles: number | null = null;
  if (duration === "n_cycles") {
    if (!isInteger(input.durationCycles)) {
      return { ok: false, error: "Informe a quantidade de ciclos" };
    }
    if (
      input.durationCycles < 1 ||
      input.durationCycles > MAX_DURATION_CYCLES
    ) {
      return { ok: false, error: "A quantidade de ciclos precisa ser de 1 a 120" };
    }
    durationCycles = input.durationCycles;
  } else if (
    input.durationCycles !== undefined &&
    input.durationCycles !== null
  ) {
    return {
      ok: false,
      error: "A quantidade de ciclos só existe na duração por ciclos",
    };
  }

  return {
    ok: true,
    terms: {
      format: format as ReferralAgreementFormat,
      percentageBps,
      fixedAmountCentavos,
      duration: duration as ReferralAgreementDuration,
      durationCycles,
    },
  };
}

/** "10%" ou "R$ 50,00" — o valor do acordo como o afiliado o lê. */
export function describeAgreementValue(
  terms: Pick<
    ReferralAgreementTerms,
    "format" | "percentageBps" | "fixedAmountCentavos"
  >,
): string {
  if (terms.format === "percentage") {
    const percentage = (terms.percentageBps ?? 0) / 100;
    return `${percentage.toLocaleString("pt-BR", {
      maximumFractionDigits: 2,
    })}%`;
  }
  return ((terms.fixedAmountCentavos ?? 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function describeAgreementFormat(
  terms: Pick<ReferralAgreementTerms, "format">,
): string {
  return terms.format === "percentage"
    ? "Percentual sobre o valor líquido"
    : "Valor fixo por fatura";
}

export function describeAgreementDuration(
  terms: Pick<ReferralAgreementTerms, "duration" | "durationCycles">,
): string {
  if (terms.duration === "lifetime") return "Vitalícia";
  if (terms.duration === "first_sale") return "Somente a primeira venda";
  const cycles = terms.durationCycles ?? 0;
  return cycles === 1 ? "1 ciclo" : `${cycles} ciclos`;
}
