// Baixa de saldo negativo — a válvula do programa (ticket 12).
//
// Por que ela existe: o prazo de chargeback de cartão no Brasil é de 90 a 180
// dias e a carência do programa é de 30. Um estorno chegando DEPOIS de o
// afiliado já ter sacado o dinheiro é evento esperado, não anomalia (ADR 0026).
// Quando isso acontece o saldo fica negativo, e nenhum saque novo passa até
// zerar.
//
// Como o ledger é imutável, a única saída é um lançamento compensatório
// explícito, com autor e motivo gravados e visível no extrato do afiliado.
// Nunca um `UPDATE` que faça o problema desaparecer. Este módulo é a decisão
// dessa baixa, isolada do banco:
//
//   1. **Só saldo negativo pode receber baixa.** Uma baixa num saldo positivo
//      seria dinheiro criado do nada, com aparência de correção contábil.
//   2. **O motivo é obrigatório.** Uma baixa sem motivo é indistinguível de um
//      erro de operação seis meses depois, e é justamente ela que precisa
//      sobreviver a uma auditoria.
//   3. **A baixa nunca passa da dívida.** Zerar é o teto; reduzir é permitido
//      (uma baixa parcial existe para o acordo caso a caso com o afiliado), e
//      passar disso viraria crédito.
//
// A outra saída não exige nada de ninguém e não mora aqui: uma comissão nova
// creditada num saldo negativo o reduz naturalmente, porque o saldo é a soma
// dos lançamentos. As duas coexistem.

/** Motivo curto demais é o mesmo que motivo nenhum. */
export const REFERRAL_WRITE_OFF_MIN_REASON_LENGTH = 5;

export type ReferralWriteOffRefusal =
  | "balance_not_negative"
  | "missing_reason"
  | "invalid_amount"
  | "above_debt";

export type ReferralWriteOffInput = {
  /**
   * Liberado menos os saques em aberto — o MESMO número que bloqueia o saque
   * em `automatize-frontend/lib/referral/payout.ts`. É ele, e não a soma crua
   * do ledger, porque a promessa do ticket é "depois da baixa o afiliado volta
   * a conseguir pedir saque": zerar um número diferente do que trava o pedido
   * deixaria o afiliado travado com o extrato aparentemente zerado, que é a
   * pior das duas situações possíveis.
   */
  availableCentavos: number;
  /** O valor da baixa em centavos. `null` = a dívida inteira. */
  requestedCentavos: number | null;
  /** O que aconteceu, nas palavras de quem lançou. Vai para o log administrativo. */
  reason: string;
};

export type ReferralWriteOffEvaluation =
  | {
      ok: true;
      /** Sempre positivo: a baixa é um crédito compensatório. */
      amountCentavos: number;
      /** Já limpo e sem espaço sobrando — é este que deve ser gravado. */
      reason: string;
      /** A baixa zera a dívida, ou apenas a reduz? */
      clearsBalance: boolean;
    }
  | { ok: false; refusal: ReferralWriteOffRefusal; message: string };

/** A dívida do afiliado: o negativo em módulo, ou zero quando não há dívida. */
export function referralDebtCentavos(availableCentavos: number): number {
  return availableCentavos < 0 ? -availableCentavos : 0;
}

/**
 * A baixa pode ser lançada, e de quanto?
 *
 * A ordem das recusas é a ordem em que elas fazem sentido para o operador:
 * primeiro o estado do saldo (que não depende do que ele digitou), depois o
 * motivo, e só então o valor.
 */
export function evaluateReferralWriteOff(
  input: ReferralWriteOffInput,
): ReferralWriteOffEvaluation {
  const debtCentavos = referralDebtCentavos(input.availableCentavos);

  if (debtCentavos === 0) {
    return {
      ok: false,
      refusal: "balance_not_negative",
      message:
        "O saldo deste afiliado não está negativo — não há dívida a dar baixa.",
    };
  }

  const reason = input.reason.trim();
  if (reason.length < REFERRAL_WRITE_OFF_MIN_REASON_LENGTH) {
    return {
      ok: false,
      refusal: "missing_reason",
      message:
        "Descreva o motivo da baixa — ele fica gravado no histórico e é o que explica o lançamento depois.",
    };
  }

  const amountCentavos = input.requestedCentavos ?? debtCentavos;

  if (!Number.isSafeInteger(amountCentavos) || amountCentavos <= 0) {
    return {
      ok: false,
      refusal: "invalid_amount",
      message: "O valor da baixa precisa ser um número inteiro positivo de centavos.",
    };
  }

  if (amountCentavos > debtCentavos) {
    return {
      ok: false,
      refusal: "above_debt",
      message: `A baixa não pode passar da dívida de ${formatCentavos(debtCentavos)}.`,
    };
  }

  return {
    ok: true,
    amountCentavos,
    reason,
    clearsBalance: amountCentavos === debtCentavos,
  };
}

/**
 * `19000` → `R$ 190,00`. Escrito à mão, sem `Intl`: o formatador do navegador
 * separa "R$" do número com um espaço NÃO separável, que atravessa qualquer
 * comparação de string sem avisar e transforma um teste de mensagem numa
 * caça ao caractere invisível.
 */
export function formatCentavos(centavos: number): string {
  const [reais, cents] = (Math.abs(centavos) / 100).toFixed(2).split(".");
  const grouped = reais.replace(/\B(?=(\d{3})+$)/g, ".");
  return `${centavos < 0 ? "-" : ""}R$ ${grouped},${cents}`;
}

/**
 * Lê o valor que o operador digitou em reais e devolve centavos.
 *
 * Existe aqui, e não na tela, porque errar a leitura de "1.234,56" é errar o
 * valor de um lançamento de dinheiro por um fator de cem. Aceita o formato
 * brasileiro ("1.234,56"), o simples ("1234,56" / "1234.56") e o inteiro
 * ("1234"). Qualquer outra coisa devolve `null` — a tela recusa em vez de
 * adivinhar.
 */
export function parseReaisToCentavos(raw: string): number | null {
  const cleaned = raw.replace(/\s|R\$/gi, "");
  if (cleaned.length === 0) return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(cleaned)) {
    return null;
  }

  // Com vírgula, o ponto só pode ser separador de milhar. Sem vírgula, um
  // agrupamento de milhares ("1.234") é ponto de milhar, e qualquer outro
  // ponto é decimal ("1234.56").
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(cleaned)
      ? cleaned.replace(/\./g, "")
      : cleaned;

  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;

  return Math.round(value * 100);
}
