import {
  brtStartOfCalendarDate,
  formatBrtCalendarDate,
  shiftCalendarDate,
} from "./dashboard-date-range";
import {
  resolveAutomatizeProductNetCentavos,
  resolveProductPaymentAmounts,
  type FinanceProductPaymentRow,
} from "./finance-payments";

/**
 * Painel "Vendas de produtos": métricas de venda dos produtos digitais num
 * período, no estilo do painel da Kiwify. Só BRL — `product_orders.currency`
 * tem CHECK em `brl`, então não há moeda para escolher.
 */

export const PRODUCT_SALES_PERIOD_VALUES = [
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "this_month",
  "last_month",
] as const;

export type ProductSalesPeriod = (typeof PRODUCT_SALES_PERIOD_VALUES)[number];

export const PRODUCT_SALES_PERIOD_LABELS: Record<ProductSalesPeriod, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  last_7_days: "Últimos 7 dias",
  last_30_days: "Últimos 30 dias",
  this_month: "Este mês",
  last_month: "Mês passado",
};

export type ProductSalesBucket = "hour" | "day";

export type ProductSalesWindow = {
  period: ProductSalesPeriod;
  /** Data de calendário BRT (YYYY-MM-DD) do primeiro dia do período. */
  fromDate: string;
  /** Data de calendário BRT (YYYY-MM-DD) do último dia, inclusivo. */
  throughDate: string;
  gte: Date;
  lt: Date;
  /** Um dia só vira série por hora; mais de um dia, por dia. */
  bucket: ProductSalesBucket;
};

export function resolveProductSalesPeriod(value: unknown): ProductSalesPeriod {
  return PRODUCT_SALES_PERIOD_VALUES.includes(value as ProductSalesPeriod)
    ? (value as ProductSalesPeriod)
    : "today";
}

export function resolveProductSalesWindow(
  period: ProductSalesPeriod,
  now: Date = new Date(),
): ProductSalesWindow {
  const today = formatBrtCalendarDate(now);
  const firstOfThisMonth = `${today.slice(0, 8)}01`;
  let fromDate = today;
  let throughDate = today;

  switch (period) {
    case "today":
      break;
    case "yesterday":
      fromDate = shiftCalendarDate(today, -1);
      throughDate = fromDate;
      break;
    case "last_7_days":
      fromDate = shiftCalendarDate(today, -6);
      break;
    case "last_30_days":
      fromDate = shiftCalendarDate(today, -29);
      break;
    case "this_month":
      fromDate = firstOfThisMonth;
      break;
    case "last_month": {
      throughDate = shiftCalendarDate(firstOfThisMonth, -1);
      fromDate = `${throughDate.slice(0, 8)}01`;
      break;
    }
  }

  return {
    period,
    fromDate,
    throughDate,
    gte: brtStartOfCalendarDate(fromDate),
    lt: brtStartOfCalendarDate(shiftCalendarDate(throughDate, 1)),
    bucket: fromDate === throughDate ? "hour" : "day",
  };
}

export type ProductSalesOrderStatus =
  | "pending"
  | "approved"
  | "failed"
  | "canceled"
  | "refunded";

/**
 * Uma linha por pedido, com o pagamento (se existir) achatado. Os campos
 * financeiros são os mesmos que a página de Finanças usa, para o "valor
 * líquido" bater com o que ela mostra.
 */
export type ProductSalesOrderRow = Pick<
  FinanceProductPaymentRow,
  | "grossAmountCentavos"
  | "netAmountCentavos"
  | "feeAmountCentavos"
  | "priceCentavos"
  | "ownerType"
  | "financialModel"
  | "platformFeeBasisPoints"
  | "platformFeeFixedCentavos"
  | "platformFeeGrossCentavos"
  | "automatizeCoproductionRevenueCentavos"
  | "automatizeProductRevenueCentavos"
  | "automatizeTotalNetRevenueCentavos"
  | "expertShareBasisPoints"
  | "coproducerShareBasisPoints"
  | "coproducerTypeSnapshot"
  | "expertSettlement"
  | "ownerExpertReceivableCentavos"
  | "gatewayFeeEstimateBps"
  | "gatewayFeeEstimateFixedCentavos"
  | "expertRevenueCentavos"
> & {
  orderId: string;
  productId: string;
  createdAt: Date;
  approvedAt: Date | null;
  refundedAt: Date | null;
  orderStatus: ProductSalesOrderStatus;
  paymentStatus: string | null;
  /** Vazio quando o pedido ainda não tem pagamento. */
  provider: string;
  paymentMethodId: string | null;
  paymentTypeId: string | null;
};

export type ProductSalesMethod = "pix" | "card" | "unknown";

/**
 * Mesma regra de `describeProductPaymentProvider`: Mercado Pago só processa
 * Pix aqui, Stripe só cartão.
 */
export function classifyProductSalesMethod(
  row: Pick<ProductSalesOrderRow, "paymentMethodId" | "paymentTypeId"> & {
    provider: string | null;
  },
): ProductSalesMethod {
  const method = row.paymentMethodId?.toLowerCase();
  const type = row.paymentTypeId?.toLowerCase();
  if (method === "pix" || type === "bank_transfer") return "pix";
  if (row.provider === "mercadopago") return "pix";
  if (row.provider === "stripe" || type === "credit_card" || type === "debit_card") {
    return "card";
  }
  return "unknown";
}

export type ProductSalesSummary = {
  /** Pedidos aprovados no período (inclui os reembolsados depois). */
  salesCount: number;
  grossCentavos: number;
  /** Líquido da Automatize; reembolso zera a parcela do pedido. */
  netCentavos: number;
  cardApproved: number;
  /** Cartões que já tiveram resposta do gateway: aprovados + recusados. */
  cardDecided: number;
  cardApprovalPercent: number | null;
  pixGenerated: number;
  pixApproved: number;
  pixConversionPercent: number | null;
  refundCount: number;
  refundPercent: number | null;
  chargebackCount: number;
  chargebackPercent: number | null;
};

export type ProductSalesPoint = {
  key: string;
  label: string;
  grossCentavos: number;
  salesCount: number;
};

export type ProductSalesDashboard = {
  summary: ProductSalesSummary;
  series: ProductSalesPoint[];
};

const BRT_OFFSET_HOURS = 3;

function isInWindow(date: Date | null, window: ProductSalesWindow): boolean {
  return date !== null && date >= window.gte && date < window.lt;
}

function wasApproved(row: ProductSalesOrderRow): boolean {
  return row.orderStatus === "approved" || row.orderStatus === "refunded";
}

function percent(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function resolveNetCentavos(row: ProductSalesOrderRow): number {
  const amounts = resolveProductPaymentAmounts(row);
  return resolveAutomatizeProductNetCentavos(row, amounts.gatewayNetCentavos) ?? 0;
}

function bucketKey(date: Date, window: ProductSalesWindow): string {
  if (window.bucket === "day") return formatBrtCalendarDate(date);
  const hour = (date.getUTCHours() - BRT_OFFSET_HOURS + 24) % 24;
  return `${window.fromDate}T${String(hour).padStart(2, "0")}`;
}

function emptySeries(window: ProductSalesWindow): ProductSalesPoint[] {
  if (window.bucket === "hour") {
    return Array.from({ length: 24 }, (_, hour) => {
      const hh = String(hour).padStart(2, "0");
      return {
        key: `${window.fromDate}T${hh}`,
        label: `${hh}h`,
        grossCentavos: 0,
        salesCount: 0,
      };
    });
  }
  const points: ProductSalesPoint[] = [];
  for (
    let date = window.fromDate;
    date <= window.throughDate;
    date = shiftCalendarDate(date, 1)
  ) {
    const [, month, day] = date.split("-");
    points.push({ key: date, label: `${day}/${month}`, grossCentavos: 0, salesCount: 0 });
  }
  return points;
}

export function buildProductSalesDashboard(
  rows: ProductSalesOrderRow[],
  window: ProductSalesWindow,
): ProductSalesDashboard {
  const series = emptySeries(window);
  const seriesByKey = new Map(series.map((point) => [point.key, point]));

  let salesCount = 0;
  let grossCentavos = 0;
  let netCentavos = 0;
  let chargebackCount = 0;
  let refundCount = 0;
  let cardApproved = 0;
  let cardDecided = 0;
  let pixGenerated = 0;
  let pixApproved = 0;

  for (const row of rows) {
    // Vendas, faturamento e chargeback: pelo dia da aprovação.
    if (wasApproved(row) && isInWindow(row.approvedAt, window)) {
      salesCount += 1;
      const gross = resolveProductPaymentAmounts(row).grossCentavos;
      grossCentavos += gross;
      netCentavos += resolveNetCentavos(row);
      if (row.paymentStatus === "charged_back") chargebackCount += 1;
      const point = seriesByKey.get(bucketKey(row.approvedAt as Date, window));
      if (point) {
        point.grossCentavos += gross;
        point.salesCount += 1;
      }
    }

    // Reembolsos: pelo dia do reembolso.
    if (row.orderStatus === "refunded" && isInWindow(row.refundedAt, window)) {
      refundCount += 1;
    }

    // Aprovação de cartão e conversão de Pix: pela coorte de pedidos criados
    // no período, que é a pergunta "do que foi tentado, quanto virou venda".
    if (isInWindow(row.createdAt, window)) {
      const method = classifyProductSalesMethod(row);
      if (method === "card") {
        if (wasApproved(row)) {
          cardApproved += 1;
          cardDecided += 1;
        } else if (row.orderStatus === "failed") {
          cardDecided += 1;
        }
      } else if (method === "pix") {
        pixGenerated += 1;
        if (wasApproved(row)) pixApproved += 1;
      }
    }
  }

  return {
    summary: {
      salesCount,
      grossCentavos,
      netCentavos,
      cardApproved,
      cardDecided,
      cardApprovalPercent: percent(cardApproved, cardDecided),
      pixGenerated,
      pixApproved,
      pixConversionPercent: percent(pixApproved, pixGenerated),
      refundCount,
      refundPercent: percent(refundCount, salesCount),
      chargebackCount,
      chargebackPercent: percent(chargebackCount, salesCount),
    },
    series,
  };
}
