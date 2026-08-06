// Métricas e alertas do programa de afiliados v2 (ticket 14) — a decisão,
// isolada do banco.
//
// A métrica que carrega a decisão é a **margem líquida por afiliado**: receita
// líquida gerada menos comissão. O ranking por receita, sozinho, esconde
// exatamente o caso que mais importa — o afiliado que traz volume e dá
// prejuízo. Como a duração padrão do acordo é vitalícia, o passivo cresce
// indefinidamente, e essa métrica é o único freio informado (ADR 0026).
//
// Três definições deste arquivo carregam dinheiro e por isso moram aqui, com
// teste, em vez de dentro de um `SELECT`:
//
//   1. **Passivo de Comissão é comissão gerada e ainda NÃO paga** — prevista,
//      aprovada e retida em saques abertos. Deliberadamente não é uma projeção
//      de obrigação futura: com acordo vitalício o horizonte é infinito e
//      depende de quanto tempo cada indicado continua assinando, então seria
//      estimativa, não fato.
//   2. **O passivo é lido do LEDGER, não do estado da Comissão.** O ledger é
//      onde o dinheiro se move: crédito da comissão, débito da reversão, débito
//      do saque pago, crédito da baixa. Somar comissões por estado daria o
//      número errado no dia seguinte ao primeiro saque, porque nada marca uma
//      Comissão individual como paga — o saque desconta do SALDO, não de uma
//      comissão específica.
//   3. **Um saldo negativo não vira passivo negativo.** Um afiliado devendo
//      (estorno que chegou depois do repasse) não reduz o que a empresa deve
//      aos outros; o passivo soma só os positivos, e a dívida aparece na fila
//      da baixa, na tela de saques.
//
// Nada aqui toca banco: os dados chegam já agregados de `metrics-queries.ts`.

import type {
  ReferralAffiliateStatus,
  ReferralCommissionStatus,
} from "@/lib/db/schema";
import { formatCentavos } from "./write-off";

/**
 * Quantos dias um Evento Comissionável pode ficar em *aguardando liquidação*
 * antes de virar alerta.
 *
 * Três dias porque os dois gateways liquidam em horas: o Stripe expõe a
 * `balance_transaction` junto com a cobrança, e o Mercado Pago devolve o
 * líquido na consulta do pagamento. Passado esse prazo, o que existe não é
 * demora — é uma chamada que nunca dá certo. E um evento cujo líquido nunca
 * chega vira comissão silenciosamente não paga: sem líquido não há comissão
 * (ADR 0026), e o afiliado nunca saberá que ela existiu.
 */
export const REFERRAL_SETTLEMENT_STUCK_DAYS = 3;

/** Os cinco estados da Comissão, em português. */
export const REFERRAL_COMMISSION_STATUS_LABELS: Record<
  ReferralCommissionStatus,
  string
> = {
  foreseen: "Prevista",
  approved: "Aprovada",
  paid: "Paga",
  reversed: "Revertida",
  rejected: "Recusada",
};

/**
 * Os estados que representam comissão VIVA — gerada e ainda devida ou já paga.
 * `reversed` e `rejected` ficam de fora: a primeira foi desfeita por estorno, a
 * segunda nunca chegou a valer.
 */
export const REFERRAL_LIVE_COMMISSION_STATUSES = [
  "foreseen",
  "approved",
  "paid",
] as const satisfies readonly ReferralCommissionStatus[];

// ---------------------------------------------------------------------------
// Comissões pelos cinco estados
// ---------------------------------------------------------------------------

export type ReferralCommissionStatusTotal = {
  count: number;
  amountCentavos: number;
};

export type ReferralCommissionStatusTotals = Record<
  ReferralCommissionStatus,
  ReferralCommissionStatusTotal
>;

/**
 * Os cinco estados, sempre — inclusive os zerados. Um estado que some da tela
 * obriga o operador a saber de cor quais existem, e "não aparece" fica
 * indistinguível de "não tem nenhum".
 */
export function emptyReferralCommissionStatusTotals(): ReferralCommissionStatusTotals {
  return {
    foreseen: { count: 0, amountCentavos: 0 },
    approved: { count: 0, amountCentavos: 0 },
    paid: { count: 0, amountCentavos: 0 },
    reversed: { count: 0, amountCentavos: 0 },
    rejected: { count: 0, amountCentavos: 0 },
  };
}

export function tallyReferralCommissionStatuses(
  rows: readonly {
    status: ReferralCommissionStatus;
    count: number;
    amountCentavos: number;
  }[],
): ReferralCommissionStatusTotals {
  const totals = emptyReferralCommissionStatusTotals();
  for (const row of rows) {
    totals[row.status].count += row.count;
    totals[row.status].amountCentavos += row.amountCentavos;
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Passivo de Comissão
// ---------------------------------------------------------------------------

export type ReferralLiabilityInput = {
  /** Soma de TODOS os lançamentos do afiliado — comissão, reversão, saque, baixa. */
  ledgerTotalCentavos: number;
  /** A parte ainda em carência (`available_at` no futuro). */
  inGraceCentavos: number;
  /**
   * Pedidos de saque abertos. Não têm lançamento enquanto abertos (ADR 0026),
   * então continuam dentro do total do ledger — é por isso que eles são uma
   * FATIA do passivo, e não uma parcela somada por fora.
   */
  openPayoutCentavos: number;
};

/**
 * O passivo de um afiliado, decomposto em três fatias que somam exatamente o
 * total. A decomposição existe porque "quanto devo" e "quanto posso ser
 * cobrado esta semana" são perguntas diferentes: o que está em carência ainda
 * pode virar reversão, o que está em saque aberto já está na mesa do operador.
 */
export type ReferralLiabilityBreakdown = {
  /** Gerado e ainda não pago. Nunca negativo. */
  totalCentavos: number;
  /** Ainda em carência — o afiliado nem pode pedir. */
  inGraceCentavos: number;
  /** Retido em saques abertos — pedido feito, dinheiro ainda não saiu. */
  heldInOpenPayoutsCentavos: number;
  /** Liberado, sem pedido aberto: o afiliado pode pedir a qualquer momento. */
  readyToRequestCentavos: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * O passivo de UM afiliado.
 *
 * O total é `max(0, soma do ledger)`: um saldo negativo é dívida DO afiliado
 * (estorno chegado depois do repasse), não obrigação da empresa, e somá-lo como
 * negativo faria a dívida de um esconder o que se deve a outro.
 *
 * As fatias são recortadas do total nessa ordem — carência, depois saque
 * aberto, depois o resto — porque é a ordem em que o dinheiro sai do alcance do
 * afiliado. Cada uma é limitada pelo que sobrou, de modo que a soma bata com o
 * total mesmo quando o afiliado tem reversões pendentes derrubando o saldo.
 */
export function referralAffiliateLiability(
  input: ReferralLiabilityInput,
): ReferralLiabilityBreakdown {
  const totalCentavos = Math.max(0, input.ledgerTotalCentavos);
  const inGraceCentavos = clamp(input.inGraceCentavos, 0, totalCentavos);
  const heldInOpenPayoutsCentavos = clamp(
    input.openPayoutCentavos,
    0,
    totalCentavos - inGraceCentavos,
  );

  return {
    totalCentavos,
    inGraceCentavos,
    heldInOpenPayoutsCentavos,
    readyToRequestCentavos:
      totalCentavos - inGraceCentavos - heldInOpenPayoutsCentavos,
  };
}

export type ReferralLiabilitySummary = ReferralLiabilityBreakdown & {
  /** Quantos afiliados têm passivo maior que zero. */
  affiliatesOwedCount: number;
};

/** O Passivo de Comissão do programa: a soma dos passivos individuais. */
export function summarizeReferralLiability(
  rows: readonly ReferralLiabilityInput[],
): ReferralLiabilitySummary {
  const summary: ReferralLiabilitySummary = {
    totalCentavos: 0,
    inGraceCentavos: 0,
    heldInOpenPayoutsCentavos: 0,
    readyToRequestCentavos: 0,
    affiliatesOwedCount: 0,
  };

  for (const row of rows) {
    const liability = referralAffiliateLiability(row);
    summary.totalCentavos += liability.totalCentavos;
    summary.inGraceCentavos += liability.inGraceCentavos;
    summary.heldInOpenPayoutsCentavos += liability.heldInOpenPayoutsCentavos;
    summary.readyToRequestCentavos += liability.readyToRequestCentavos;
    if (liability.totalCentavos > 0) summary.affiliatesOwedCount += 1;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// EPC — ganho por clique
// ---------------------------------------------------------------------------

/**
 * EPC: comissão gerada dividida pelos cliques.
 *
 * Devolve `null` sem clique nenhum, e não zero: um afiliado que ainda não
 * divulgou não tem eficiência ruim — ele não tem medida. Zerar os dois casos
 * juntos faria o operador comparar quem fracassou com quem nem começou.
 */
export function computeReferralEpcCentavos(
  commissionCentavos: number,
  clicks: number,
): number | null {
  if (clicks <= 0) return null;
  return commissionCentavos / clicks;
}

// ---------------------------------------------------------------------------
// Concentração do top 10%
// ---------------------------------------------------------------------------

export type ReferralConcentration = {
  /** Quantos afiliados entraram na conta. */
  affiliateCount: number;
  /** Quantos formam o topo — sempre ao menos um, quando há alguém. */
  topCount: number;
  topCentavos: number;
  totalCentavos: number;
  /** Fatia do topo, de 0 a 1. `null` quando não há total do qual tirar fatia. */
  share: number | null;
};

/**
 * O quanto o programa depende de poucas pessoas.
 *
 * `ceil` e o piso de um: com nove afiliados, "top 10%" arredondado para baixo
 * seria zero afiliado e 0% de concentração — a resposta mais enganosa possível
 * num programa que ainda depende de uma pessoa só.
 *
 * Valores negativos são tratados como zero. Nenhum afiliado gera receita
 * negativa; um número negativo aqui só poderia vir de um agregado torto, e
 * deixá-lo entrar inflaria a fatia do topo dividindo por um total menor.
 */
export function computeReferralTopDecile(
  values: readonly number[],
): ReferralConcentration {
  const positives = values.map((value) => Math.max(0, value));
  const affiliateCount = positives.length;

  if (affiliateCount === 0) {
    return {
      affiliateCount: 0,
      topCount: 0,
      topCentavos: 0,
      totalCentavos: 0,
      share: null,
    };
  }

  const totalCentavos = positives.reduce((sum, value) => sum + value, 0);
  const topCount = Math.max(1, Math.ceil(affiliateCount / 10));
  const topCentavos = [...positives]
    .sort((a, b) => b - a)
    .slice(0, topCount)
    .reduce((sum, value) => sum + value, 0);

  return {
    affiliateCount,
    topCount,
    topCentavos,
    totalCentavos,
    share: totalCentavos > 0 ? topCentavos / totalCentavos : null,
  };
}

// ---------------------------------------------------------------------------
// Métricas por afiliado
// ---------------------------------------------------------------------------

/** O que a consulta agregada entrega, antes de qualquer conta derivada. */
export type ReferralAffiliateMetricsInput = {
  affiliateId: string;
  affiliateCode: string;
  affiliateStatus: ReferralAffiliateStatus;
  user: { id: string; email: string; name: string | null };
  clicks: number;
  /** Indicados — contas atribuídas a este afiliado. */
  customers: number;
  /** Faturas comissionadas: Eventos liquidados cujo pagamento não foi estornado. */
  commissionedInvoices: number;
  grossRevenueCentavos: number;
  /** Receita líquida gerada — bruto menos taxa do gateway, sem os estornados. */
  netRevenueCentavos: number;
  /** O líquido que foi gerado e depois estornado. Contexto, não receita. */
  reversedNetRevenueCentavos: number;
  /** Comissão viva: prevista + aprovada + paga. Já exclui revertida e recusada. */
  commissionGeneratedCentavos: number;
  commissionReversedCentavos: number;
  /** Dinheiro que efetivamente saiu: a soma dos saques pagos, no ledger. */
  commissionPaidCentavos: number;
  liability: ReferralLiabilityInput;
};

export type ReferralAffiliateMetrics = Omit<
  ReferralAffiliateMetricsInput,
  "liability"
> & {
  /** Gerado e ainda não pago, deste afiliado. */
  liabilityCentavos: number;
  /**
   * Receita líquida gerada menos comissão GERADA — não menos comissão paga.
   *
   * A diferença importa: com acordo vitalício, a comissão paga hoje é uma
   * fração do que já foi prometido, e medir a margem só pelo que saiu do caixa
   * mostraria lucro num afiliado que já está no vermelho. O que ainda não foi
   * pago é passivo certo, não hipótese — por isso entra na conta.
   */
  marginCentavos: number;
  /** `null` sem clique nenhum: sem medida, e não eficiência zero. */
  epcCentavos: number | null;
};

export function withDerivedReferralMetrics(
  input: ReferralAffiliateMetricsInput,
): ReferralAffiliateMetrics {
  const { liability, ...rest } = input;
  return {
    ...rest,
    liabilityCentavos: referralAffiliateLiability(liability).totalCentavos,
    marginCentavos: input.netRevenueCentavos - input.commissionGeneratedCentavos,
    epcCentavos: computeReferralEpcCentavos(
      input.commissionGeneratedCentavos,
      input.clicks,
    ),
  };
}

export const REFERRAL_METRIC_SORT_VALUES = [
  "net_revenue",
  "commission_paid",
  "margin",
] as const;
export type ReferralMetricSort = (typeof REFERRAL_METRIC_SORT_VALUES)[number];

export const REFERRAL_METRIC_SORT_LABELS: Record<ReferralMetricSort, string> = {
  net_revenue: "Receita líquida gerada",
  commission_paid: "Comissão paga",
  margin: "Margem líquida (pior primeiro)",
};

export function parseReferralMetricSort(raw: string | null): ReferralMetricSort {
  return REFERRAL_METRIC_SORT_VALUES.includes(raw as ReferralMetricSort)
    ? (raw as ReferralMetricSort)
    : "net_revenue";
}

/**
 * Ordena o ranking.
 *
 * Receita e comissão paga descem — o maior primeiro, que é o que "ranking"
 * significa. **Margem sobe**: o pior primeiro. É deliberado e é a razão de a
 * métrica existir — ordenar margem do melhor para o pior empurraria o afiliado
 * que dá prejuízo para o fim de uma lista longa, que é exatamente o
 * esconderijo que o ranking por receita já oferece.
 *
 * O desempate é sempre a receita líquida, e depois o código: sem ele, duas
 * cargas da mesma tela poderiam trocar linhas de lugar sem nada ter mudado.
 */
export function rankReferralAffiliates(
  rows: readonly ReferralAffiliateMetrics[],
  sort: ReferralMetricSort,
): ReferralAffiliateMetrics[] {
  const byValue = (row: ReferralAffiliateMetrics): number => {
    switch (sort) {
      case "commission_paid":
        return row.commissionPaidCentavos;
      case "margin":
        return row.marginCentavos;
      default:
        return row.netRevenueCentavos;
    }
  };

  return [...rows].sort((a, b) => {
    const delta =
      sort === "margin" ? byValue(a) - byValue(b) : byValue(b) - byValue(a);
    if (delta !== 0) return delta;

    const revenueDelta = b.netRevenueCentavos - a.netRevenueCentavos;
    if (revenueDelta !== 0) return revenueDelta;

    return a.affiliateCode.localeCompare(b.affiliateCode);
  });
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

/** Quantos dias inteiros se passaram. Negativo vira zero — futuro não é atraso. */
export function referralDaysSince(since: Date, now: Date): number {
  const elapsed = now.getTime() - since.getTime();
  if (elapsed <= 0) return 0;
  return Math.floor(elapsed / 86_400_000);
}

/**
 * A data-limite do alerta: eventos ocorridos ANTES dela estão presos há tempo
 * demais. Devolvida como instante para que a consulta filtre no banco em vez de
 * trazer todos os eventos pendentes para descartar em memória.
 */
export function referralStuckSettlementThreshold(
  now: Date,
  days: number = REFERRAL_SETTLEMENT_STUCK_DAYS,
): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/**
 * Um Evento Comissionável preso em *aguardando liquidação*.
 *
 * O alerta some sozinho quando a causa é resolvida: o reconciliador completa o
 * líquido, o evento vira `settled`, e a linha deixa de existir na consulta.
 * Nada precisa ser marcado como lido — um alerta que exige ser dispensado à mão
 * acaba dispensado sem ser resolvido.
 */
export type ReferralStuckSettlementAlert = {
  eventId: string;
  eventKey: string;
  paymentId: string;
  provider: string;
  grossCentavos: number;
  occurredAt: string;
  daysStuck: number;
  affiliateId: string;
  affiliateCode: string;
  customerName: string | null;
};

/**
 * Um estorno parcial — valor devolvido menor que o valor pago.
 *
 * A política do negócio é de estorno sempre TOTAL, então um parcial significa
 * que alguém errou no painel do gateway ou que apareceu um crédito de
 * proration. A comissão é revertida integralmente de qualquer jeito (ADR 0026);
 * o alerta existe para que a anomalia apareça em vez de sumir.
 *
 * Também some sozinho: no instante em que o gateway completa o estorno,
 * `refunded_amount` alcança o bruto e a linha sai da consulta.
 */
export type ReferralPartialReversalAlert = {
  paymentId: string;
  provider: string;
  reversalKind: string;
  paidCentavos: number;
  refundedCentavos: number;
  /** O que faltou devolver — o número que se confere no painel do gateway. */
  gapCentavos: number;
  refundedAt: string | null;
  /** `null` quando o pagamento não é de um Indicado: a anomalia é do PAGAMENTO. */
  affiliateCode: string | null;
  userEmail: string;
};

export function referralPartialReversalGap(
  paidCentavos: number,
  refundedCentavos: number,
): number {
  return Math.max(0, paidCentavos - refundedCentavos);
}

/** Uma linha legível do alerta, para o log da operação e para o roteiro. */
export function describeReferralPartialReversal(
  alert: ReferralPartialReversalAlert,
): string {
  return [
    `pago ${formatCentavos(alert.paidCentavos)}`,
    `estornado ${formatCentavos(alert.refundedCentavos)}`,
    `faltam ${formatCentavos(alert.gapCentavos)}`,
  ].join(" · ");
}

// ---------------------------------------------------------------------------
// O pacote inteiro
// ---------------------------------------------------------------------------

export type ReferralProgramMetrics = {
  generatedAt: string;
  /** O ranking já ordenado. */
  affiliates: ReferralAffiliateMetrics[];
  commissionsByStatus: ReferralCommissionStatusTotals;
  liability: ReferralLiabilitySummary;
  totals: {
    clicks: number;
    customers: number;
    commissionedInvoices: number;
    grossRevenueCentavos: number;
    netRevenueCentavos: number;
    commissionGeneratedCentavos: number;
    commissionPaidCentavos: number;
    marginCentavos: number;
    /** EPC do programa: comissão gerada dividida por TODOS os cliques. */
    epcCentavos: number | null;
  };
  /** Concentração medida sobre a receita líquida gerada. */
  concentration: ReferralConcentration;
  alerts: {
    stuckSettlementDays: number;
    stuckSettlements: ReferralStuckSettlementAlert[];
    partialReversals: ReferralPartialReversalAlert[];
  };
};

/**
 * Junta tudo: os totais do programa são a soma das linhas, e não uma segunda
 * consulta. Duas contagens independentes do mesmo número acabariam divergindo,
 * e o operador não teria como saber qual das duas está certa.
 */
export function summarizeReferralProgram(
  rows: readonly ReferralAffiliateMetrics[],
): Pick<ReferralProgramMetrics, "totals" | "concentration"> {
  const totals = {
    clicks: 0,
    customers: 0,
    commissionedInvoices: 0,
    grossRevenueCentavos: 0,
    netRevenueCentavos: 0,
    commissionGeneratedCentavos: 0,
    commissionPaidCentavos: 0,
    marginCentavos: 0,
    epcCentavos: null as number | null,
  };

  for (const row of rows) {
    totals.clicks += row.clicks;
    totals.customers += row.customers;
    totals.commissionedInvoices += row.commissionedInvoices;
    totals.grossRevenueCentavos += row.grossRevenueCentavos;
    totals.netRevenueCentavos += row.netRevenueCentavos;
    totals.commissionGeneratedCentavos += row.commissionGeneratedCentavos;
    totals.commissionPaidCentavos += row.commissionPaidCentavos;
  }

  totals.marginCentavos =
    totals.netRevenueCentavos - totals.commissionGeneratedCentavos;
  totals.epcCentavos = computeReferralEpcCentavos(
    totals.commissionGeneratedCentavos,
    totals.clicks,
  );

  return {
    totals,
    concentration: computeReferralTopDecile(
      rows.map((row) => row.netRevenueCentavos),
    ),
  };
}

/** `0.4213` → `42,1%`. `null` → `—`, porque "sem dado" não é zero por cento. */
export function formatShare(share: number | null): string {
  if (share === null) return "—";
  return `${(share * 100).toFixed(1).replace(".", ",")}%`;
}

/** O EPC em reais, ou `—` quando não há clique do qual tirar média. */
export function formatEpc(epcCentavos: number | null): string {
  if (epcCentavos === null) return "—";
  return formatCentavos(Math.round(epcCentavos));
}
