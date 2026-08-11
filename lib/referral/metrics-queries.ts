// As métricas e os alertas do programa de afiliados v2, ligados ao banco
// (ticket 14).
//
// A divisão é a mesma dos outros arquivos do domínio: aqui só se busca estado
// agregado; toda definição que poderia ser escrita de outro jeito e continuar
// "parecendo certa" mora em `metrics.ts`, com teste. Este arquivo tem uma
// responsabilidade adicional própria, e é dela que vem seu formato:
//
//   **cada número é agregado UMA vez, por afiliado, e os totais do programa
//   são a soma dessas linhas.** Um `SUM` global independente do `SUM` por
//   afiliado acabaria divergindo — arredondamento, um `JOIN` a mais, um filtro
//   que só um dos dois recebeu — e o operador não teria como saber qual dos
//   dois está certo. A conferência manual pedida pelo ticket depende disso: as
//   linhas cruas precisam somar exatamente o que o cabeçalho mostra.
//
// Os dois alertas são consultas puras de estado, sem tabela própria e sem
// marcação de "lido". É isso que faz um alerta sumir quando a causa é
// resolvida: o evento vira `settled` e some do filtro; o gateway completa o
// estorno e `refunded_amount` alcança o bruto. Um alerta que precisa ser
// dispensado à mão acaba dispensado sem ser resolvido.

import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payment,
  referralAffiliate,
  referralClick,
  referralCommission,
  referralCommissionableEvent,
  referralCustomer,
  referralLedgerEntry,
  referralPayoutRequest,
  user,
  type ReferralAffiliateStatus,
  type ReferralCommissionStatus,
} from "@/lib/db/schema";
import { OPEN_REFERRAL_PAYOUT_STATUSES } from "./payout";
import { classifyReferralClick } from "./traffic";
import {
  rankReferralAffiliates,
  referralDaysSince,
  referralPartialReversalGap,
  referralStuckSettlementThreshold,
  summarizeReferralLiability,
  summarizeReferralProgram,
  tallyReferralCommissionStatuses,
  withDerivedReferralMetrics,
  REFERRAL_LIVE_COMMISSION_STATUSES,
  REFERRAL_SETTLEMENT_STUCK_DAYS,
  type ReferralAffiliateMetricsInput,
  type ReferralMetricSort,
  type ReferralPartialReversalAlert,
  type ReferralProgramMetrics,
  type ReferralStuckSettlementAlert,
} from "./metrics";

/**
 * O bruto do pagamento: `gross_amount` quando o gateway o gravou,
 * `amount` como fallback. A MESMA regra de `grossOf` no motor de comissão
 * (`automatize-frontend/lib/referral/commission.ts`) — se as duas divergissem,
 * o alerta de estorno parcial acusaria anomalia onde o motor não vê nenhuma.
 */
const paymentGross = sql<number>`COALESCE(${payment.grossAmount}, ${payment.amount})`;

/** Quem entra no ranking: todo afiliado que já foi aprovado alguma vez. */
type AffiliateIdentity = {
  affiliateId: string;
  affiliateCode: string;
  affiliateStatus: ReferralAffiliateStatus;
  user: { id: string; email: string; name: string | null };
};

async function listAffiliateIdentities(): Promise<AffiliateIdentity[]> {
  const rows = await db
    .select({
      affiliateId: referralAffiliate.id,
      affiliateCode: referralAffiliate.code,
      affiliateStatus: referralAffiliate.status,
      user: { id: user.id, email: user.email, name: user.name },
    })
    .from(referralAffiliate)
    .innerJoin(user, eq(user.id, referralAffiliate.userId))
    // Pendentes e recusados nunca geraram clique nem comissão — só engrossariam
    // o denominador da concentração com linhas zeradas. Bloqueado FICA: ele
    // parou de gerar comissão nova, mas o que já gerou continua sendo custo e
    // receita do programa.
    .where(inArray(referralAffiliate.status, ["approved", "blocked"]));

  return rows;
}

type RevenueRow = {
  affiliateId: string;
  invoices: number;
  grossCentavos: number;
  netCentavos: number;
};

/**
 * Receita gerada por afiliado, a partir dos Eventos Comissionáveis liquidados.
 *
 * `refunded` fica de fora do lado da receita: uma venda estornada não gerou
 * receita nenhuma, e mantê-la faria a margem de um afiliado com muitos estornos
 * parecer saudável. O líquido estornado é devolvido à parte, como contexto —
 * some-lo à receita seria o mesmo erro com outro nome.
 */
async function aggregateRevenue(refunded: boolean): Promise<RevenueRow[]> {
  const rows = await db
    .select({
      affiliateId: referralCustomer.affiliateId,
      invoices: count(),
      grossCentavos: sql<number>`COALESCE(SUM(${referralCommissionableEvent.grossCentavos}), 0)::bigint`,
      netCentavos: sql<number>`COALESCE(SUM(${referralCommissionableEvent.netCentavos}), 0)::bigint`,
    })
    .from(referralCommissionableEvent)
    .innerJoin(
      referralCustomer,
      eq(referralCustomer.id, referralCommissionableEvent.customerId),
    )
    .innerJoin(payment, eq(payment.id, referralCommissionableEvent.paymentId))
    .where(
      and(
        // Só o liquidado: um evento em `aguardando liquidação` não tem líquido
        // (o CHECK do banco garante), e contá-lo como receita zero deprimiria a
        // margem de quem está apenas esperando o reconciliador.
        eq(referralCommissionableEvent.status, "settled"),
        refunded
          ? eq(payment.status, "refunded")
          : ne(payment.status, "refunded"),
      ),
    )
    .groupBy(referralCustomer.affiliateId);

  return rows.map((row) => ({
    affiliateId: row.affiliateId,
    invoices: Number(row.invoices),
    grossCentavos: Number(row.grossCentavos),
    netCentavos: Number(row.netCentavos),
  }));
}

type CommissionRow = {
  affiliateId: string;
  status: ReferralCommissionStatus;
  count: number;
  amountCentavos: number;
};

async function aggregateCommissions(): Promise<CommissionRow[]> {
  const rows = await db
    .select({
      affiliateId: referralCommission.affiliateId,
      status: referralCommission.status,
      total: count(),
      amountCentavos: sql<number>`COALESCE(SUM(${referralCommission.amountCentavos}), 0)::bigint`,
    })
    .from(referralCommission)
    .groupBy(referralCommission.affiliateId, referralCommission.status);

  return rows.map((row) => ({
    affiliateId: row.affiliateId,
    status: row.status,
    count: Number(row.total),
    amountCentavos: Number(row.amountCentavos),
  }));
}

type LedgerRow = {
  affiliateId: string;
  /** Soma de TODOS os lançamentos: é ela que vira o passivo. */
  totalCentavos: number;
  /** A parte ainda em carência. */
  inGraceCentavos: number;
  /** Quanto já saiu de fato — os saques pagos, em módulo. */
  paidOutCentavos: number;
};

/**
 * O ledger agregado por afiliado. Três somas numa passagem só porque as três
 * precisam bater entre si: o passivo é o total, a carência é uma fatia dele, e
 * o pago é o que já deixou o caixa.
 *
 * `available_at` no futuro é carência; nulo ou vencido é liberado — a mesma
 * comparação de `releasedSum` em `write-off-queries.ts` e de
 * `isLedgerEntryReleased` no frontend, escrita aqui pela terceira e última vez.
 *
 * A condição usa `isNotNull`/`gt` em vez de um `Date` interpolado num `sql`
 * cru: posto direto no template, o `Date` chega ao driver sem o tipo da coluna
 * e estoura na serialização.
 */
async function aggregateLedger(now: Date): Promise<LedgerRow[]> {
  const inGrace = and(
    isNotNull(referralLedgerEntry.availableAt),
    gt(referralLedgerEntry.availableAt, now),
  );

  const rows = await db
    .select({
      affiliateId: referralLedgerEntry.affiliateId,
      totalCentavos: sql<number>`COALESCE(SUM(${referralLedgerEntry.amountCentavos}), 0)::bigint`,
      inGraceCentavos: sql<number>`COALESCE(SUM(CASE WHEN ${inGrace} THEN ${referralLedgerEntry.amountCentavos} ELSE 0 END), 0)::bigint`,
      paidOutCentavos: sql<number>`COALESCE(SUM(CASE WHEN ${referralLedgerEntry.type} = 'payout' THEN -${referralLedgerEntry.amountCentavos} ELSE 0 END), 0)::bigint`,
    })
    .from(referralLedgerEntry)
    .groupBy(referralLedgerEntry.affiliateId);

  return rows.map((row) => ({
    affiliateId: row.affiliateId,
    totalCentavos: Number(row.totalCentavos),
    inGraceCentavos: Number(row.inGraceCentavos),
    paidOutCentavos: Number(row.paidOutCentavos),
  }));
}

async function aggregateOpenPayouts(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      affiliateId: referralPayoutRequest.affiliateId,
      amountCentavos: sql<number>`COALESCE(SUM(${referralPayoutRequest.amountCentavos}), 0)::bigint`,
    })
    .from(referralPayoutRequest)
    .where(
      inArray(referralPayoutRequest.status, [...OPEN_REFERRAL_PAYOUT_STATUSES]),
    )
    .groupBy(referralPayoutRequest.affiliateId);

  return new Map(rows.map((row) => [row.affiliateId, Number(row.amountCentavos)]));
}

/**
 * Cliques HUMANOS por afiliado. Os user-agents vêm inteiros porque a contagem
 * exclui robôs de preview (WhatsApp/Facebook buscando a URL do link) com o
 * MESMO classificador do painel de tráfego — um `count()` cego aqui faria o
 * ranking dizer 12 onde o tráfego diz 5, e o EPC dividiria por fetch de robô.
 */
async function aggregateClicks(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      affiliateId: referralClick.affiliateId,
      userAgent: referralClick.userAgent,
    })
    .from(referralClick);

  const totals = new Map<string, number>();
  for (const row of rows) {
    if (classifyReferralClick({ ...row, referrerUrl: null, landingUrl: null }).kind !== "human") {
      continue;
    }
    totals.set(row.affiliateId, (totals.get(row.affiliateId) ?? 0) + 1);
  }
  return totals;
}

async function aggregateCustomers(): Promise<Map<string, number>> {
  const rows = await db
    .select({ affiliateId: referralCustomer.affiliateId, total: count() })
    .from(referralCustomer)
    .groupBy(referralCustomer.affiliateId);

  return new Map(rows.map((row) => [row.affiliateId, Number(row.total)]));
}

/**
 * Eventos Comissionáveis presos em *aguardando liquidação* além do limite.
 *
 * Um evento cujo líquido nunca chega vira comissão silenciosamente não paga: o
 * programa não cria Comissão sem líquido (ADR 0026), e o afiliado nunca saberá
 * que ela existiu. É por isso que este alerta existe.
 */
export async function listReferralStuckSettlements(
  days: number = REFERRAL_SETTLEMENT_STUCK_DAYS,
  now: Date = new Date(),
  limit = 100,
): Promise<ReferralStuckSettlementAlert[]> {
  const threshold = referralStuckSettlementThreshold(now, days);

  const rows = await db
    .select({
      eventId: referralCommissionableEvent.id,
      eventKey: referralCommissionableEvent.eventKey,
      paymentId: referralCommissionableEvent.paymentId,
      provider: payment.provider,
      grossCentavos: referralCommissionableEvent.grossCentavos,
      occurredAt: referralCommissionableEvent.occurredAt,
      affiliateId: referralAffiliate.id,
      affiliateCode: referralAffiliate.code,
      customerName: user.name,
    })
    .from(referralCommissionableEvent)
    .innerJoin(
      referralCustomer,
      eq(referralCustomer.id, referralCommissionableEvent.customerId),
    )
    .innerJoin(
      referralAffiliate,
      eq(referralAffiliate.id, referralCustomer.affiliateId),
    )
    .innerJoin(user, eq(user.id, referralCustomer.userId))
    .innerJoin(payment, eq(payment.id, referralCommissionableEvent.paymentId))
    .where(
      and(
        eq(referralCommissionableEvent.status, "awaiting_settlement"),
        lt(referralCommissionableEvent.occurredAt, threshold),
      ),
    )
    // O mais antigo primeiro: é o que está preso há mais tempo, e é dele que a
    // comissão corre mais risco de nunca existir.
    .orderBy(asc(referralCommissionableEvent.occurredAt))
    .limit(limit);

  return rows.map((row) => ({
    eventId: row.eventId,
    eventKey: row.eventKey,
    paymentId: row.paymentId,
    provider: row.provider,
    grossCentavos: row.grossCentavos,
    occurredAt: row.occurredAt.toISOString(),
    daysStuck: referralDaysSince(row.occurredAt, now),
    affiliateId: row.affiliateId,
    affiliateCode: row.affiliateCode,
    customerName: row.customerName,
  }));
}

/**
 * Estornos parciais — valor devolvido menor que o valor pago.
 *
 * O `LEFT JOIN` com o Indicado é deliberado: a anomalia é do PAGAMENTO, não da
 * comissão, exatamente como o seam da reversão a detecta
 * (`detectPartialReversalAnomaly`). Um parcial numa venda que nunca gerou
 * comissão continua sendo alguém errando no painel do gateway, e escondê-lo
 * aqui seria escolher não ver justamente o caso em que ninguém mais olharia.
 */
export async function listReferralPartialReversals(
  limit = 100,
): Promise<ReferralPartialReversalAlert[]> {
  const rows = await db
    .select({
      paymentId: payment.id,
      provider: payment.provider,
      reversalKind: payment.reversalKind,
      paidCentavos: paymentGross,
      refundedCentavos: payment.refundedAmount,
      refundedAt: payment.refundedAt,
      affiliateCode: referralAffiliate.code,
      userEmail: user.email,
    })
    .from(payment)
    .innerJoin(user, eq(user.id, payment.userId))
    .leftJoin(referralCustomer, eq(referralCustomer.userId, payment.userId))
    .leftJoin(
      referralAffiliate,
      eq(referralAffiliate.id, referralCustomer.affiliateId),
    )
    .where(
      and(
        eq(payment.status, "refunded"),
        isNotNull(payment.refundedAt),
        isNotNull(payment.refundedAmount),
        // Bruto desconhecido é lacuna de liquidação, não anomalia de estorno —
        // a mesma recusa do seam.
        sql`${paymentGross} > 0`,
        sql`${payment.refundedAmount} < ${paymentGross}`,
      ),
    )
    .orderBy(asc(payment.refundedAt))
    .limit(limit);

  return rows.map((row) => {
    const paidCentavos = Number(row.paidCentavos);
    const refundedCentavos = Number(row.refundedCentavos ?? 0);
    return {
      paymentId: row.paymentId,
      provider: row.provider,
      reversalKind: row.reversalKind ?? "refund",
      paidCentavos,
      refundedCentavos,
      gapCentavos: referralPartialReversalGap(paidCentavos, refundedCentavos),
      refundedAt: row.refundedAt?.toISOString() ?? null,
      affiliateCode: row.affiliateCode,
      userEmail: row.userEmail,
    };
  });
}

/**
 * O pacote inteiro da tela: ranking, agregados, passivo, EPC, concentração e os
 * dois alertas.
 *
 * As consultas rodam em paralelo porque são independentes; a montagem é
 * sequencial e determinística, de modo que a mesma foto do banco produza sempre
 * os mesmos números.
 */
export async function getReferralProgramMetrics(options?: {
  sort?: ReferralMetricSort;
  stuckSettlementDays?: number;
  now?: Date;
}): Promise<ReferralProgramMetrics> {
  const now = options?.now ?? new Date();
  const sort = options?.sort ?? "net_revenue";
  const stuckSettlementDays =
    options?.stuckSettlementDays ?? REFERRAL_SETTLEMENT_STUCK_DAYS;

  const [
    identities,
    revenue,
    reversedRevenue,
    commissions,
    ledger,
    openPayouts,
    clicks,
    customers,
    stuckSettlements,
    partialReversals,
  ] = await Promise.all([
    listAffiliateIdentities(),
    aggregateRevenue(false),
    aggregateRevenue(true),
    aggregateCommissions(),
    aggregateLedger(now),
    aggregateOpenPayouts(),
    aggregateClicks(),
    aggregateCustomers(),
    listReferralStuckSettlements(stuckSettlementDays, now),
    listReferralPartialReversals(),
  ]);

  const revenueById = new Map(revenue.map((row) => [row.affiliateId, row]));
  const reversedById = new Map(
    reversedRevenue.map((row) => [row.affiliateId, row]),
  );
  const ledgerById = new Map(ledger.map((row) => [row.affiliateId, row]));

  const commissionsById = new Map<
    string,
    { generated: number; reversed: number }
  >();
  for (const row of commissions) {
    const bucket = commissionsById.get(row.affiliateId) ?? {
      generated: 0,
      reversed: 0,
    };
    if (
      (REFERRAL_LIVE_COMMISSION_STATUSES as readonly string[]).includes(
        row.status,
      )
    ) {
      bucket.generated += row.amountCentavos;
    }
    if (row.status === "reversed") bucket.reversed += row.amountCentavos;
    commissionsById.set(row.affiliateId, bucket);
  }

  const inputs: ReferralAffiliateMetricsInput[] = identities.map((identity) => {
    const earned = revenueById.get(identity.affiliateId);
    const reverted = reversedById.get(identity.affiliateId);
    const ledgerRow = ledgerById.get(identity.affiliateId);
    const commission = commissionsById.get(identity.affiliateId);

    return {
      ...identity,
      clicks: clicks.get(identity.affiliateId) ?? 0,
      customers: customers.get(identity.affiliateId) ?? 0,
      commissionedInvoices: earned?.invoices ?? 0,
      grossRevenueCentavos: earned?.grossCentavos ?? 0,
      netRevenueCentavos: earned?.netCentavos ?? 0,
      reversedNetRevenueCentavos: reverted?.netCentavos ?? 0,
      commissionGeneratedCentavos: commission?.generated ?? 0,
      commissionReversedCentavos: commission?.reversed ?? 0,
      commissionPaidCentavos: ledgerRow?.paidOutCentavos ?? 0,
      liability: {
        ledgerTotalCentavos: ledgerRow?.totalCentavos ?? 0,
        inGraceCentavos: ledgerRow?.inGraceCentavos ?? 0,
        openPayoutCentavos: openPayouts.get(identity.affiliateId) ?? 0,
      },
    };
  });

  const affiliates = inputs.map(withDerivedReferralMetrics);
  const { totals, concentration } = summarizeReferralProgram(affiliates);

  return {
    generatedAt: now.toISOString(),
    affiliates: rankReferralAffiliates(affiliates, sort),
    commissionsByStatus: tallyReferralCommissionStatuses(commissions),
    liability: summarizeReferralLiability(inputs.map((row) => row.liability)),
    totals,
    concentration,
    alerts: {
      stuckSettlementDays,
      stuckSettlements,
      partialReversals,
    },
  };
}

/**
 * As linhas cruas de UM afiliado — o que a conferência manual do ticket precisa
 * para bater com o que a tela mostra. Sem isso, "os números batem" seria uma
 * afirmação sem como ser verificada.
 */
export type ReferralAffiliateAudit = {
  affiliateId: string;
  affiliateCode: string;
  clicks: number;
  customers: number;
  events: {
    id: string;
    kind: string;
    status: string;
    grossCentavos: number;
    netCentavos: number | null;
    paymentStatus: string;
    occurredAt: string;
  }[];
  commissions: {
    id: string;
    status: ReferralCommissionStatus;
    amountCentavos: number;
    releasesAt: string;
  }[];
  ledger: {
    id: string;
    type: string;
    amountCentavos: number;
    availableAt: string | null;
    description: string | null;
  }[];
  openPayoutCentavos: number;
};

export async function auditReferralAffiliate(
  affiliateId: string,
): Promise<ReferralAffiliateAudit | null> {
  const [affiliate] = await db
    .select({ id: referralAffiliate.id, code: referralAffiliate.code })
    .from(referralAffiliate)
    .where(eq(referralAffiliate.id, affiliateId))
    .limit(1);
  if (!affiliate) return null;

  const [clickRows, customerRows, eventRows, commissionRows, ledgerRows, open] =
    await Promise.all([
      db
        .select({ total: count() })
        .from(referralClick)
        .where(eq(referralClick.affiliateId, affiliateId)),
      db
        .select({ total: count() })
        .from(referralCustomer)
        .where(eq(referralCustomer.affiliateId, affiliateId)),
      db
        .select({
          id: referralCommissionableEvent.id,
          kind: referralCommissionableEvent.kind,
          status: referralCommissionableEvent.status,
          grossCentavos: referralCommissionableEvent.grossCentavos,
          netCentavos: referralCommissionableEvent.netCentavos,
          paymentStatus: payment.status,
          occurredAt: referralCommissionableEvent.occurredAt,
        })
        .from(referralCommissionableEvent)
        .innerJoin(
          referralCustomer,
          eq(referralCustomer.id, referralCommissionableEvent.customerId),
        )
        .innerJoin(
          payment,
          eq(payment.id, referralCommissionableEvent.paymentId),
        )
        .where(eq(referralCustomer.affiliateId, affiliateId))
        .orderBy(asc(referralCommissionableEvent.occurredAt)),
      db
        .select({
          id: referralCommission.id,
          status: referralCommission.status,
          amountCentavos: referralCommission.amountCentavos,
          releasesAt: referralCommission.releasesAt,
        })
        .from(referralCommission)
        .where(eq(referralCommission.affiliateId, affiliateId))
        .orderBy(asc(referralCommission.createdAt)),
      db
        .select({
          id: referralLedgerEntry.id,
          type: referralLedgerEntry.type,
          amountCentavos: referralLedgerEntry.amountCentavos,
          availableAt: referralLedgerEntry.availableAt,
          description: referralLedgerEntry.description,
        })
        .from(referralLedgerEntry)
        .where(eq(referralLedgerEntry.affiliateId, affiliateId))
        .orderBy(asc(referralLedgerEntry.createdAt)),
      db
        .select({
          amountCentavos: sql<number>`COALESCE(SUM(${referralPayoutRequest.amountCentavos}), 0)::bigint`,
        })
        .from(referralPayoutRequest)
        .where(
          and(
            eq(referralPayoutRequest.affiliateId, affiliateId),
            inArray(referralPayoutRequest.status, [
              ...OPEN_REFERRAL_PAYOUT_STATUSES,
            ]),
          ),
        ),
    ]);

  return {
    affiliateId: affiliate.id,
    affiliateCode: affiliate.code,
    clicks: Number(clickRows[0]?.total ?? 0),
    customers: Number(customerRows[0]?.total ?? 0),
    events: eventRows.map((row) => ({
      ...row,
      occurredAt: row.occurredAt.toISOString(),
    })),
    commissions: commissionRows.map((row) => ({
      ...row,
      releasesAt: row.releasesAt.toISOString(),
    })),
    ledger: ledgerRows.map((row) => ({
      ...row,
      availableAt: row.availableAt?.toISOString() ?? null,
    })),
    openPayoutCentavos: Number(open[0]?.amountCentavos ?? 0),
  };
}
