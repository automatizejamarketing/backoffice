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

export type ProductSalesBucket = "hour" | "day";

export type ProductSalesWindow = {
  /** Data de calendário BRT (YYYY-MM-DD) do primeiro dia do período. */
  fromDate: string;
  /** Data de calendário BRT (YYYY-MM-DD) do último dia, inclusivo. */
  throughDate: string;
  gte: Date;
  lt: Date;
  /** Um dia só vira série por hora; mais de um dia, por dia. */
  bucket: ProductSalesBucket;
};

const MAX_WINDOW_DAYS = 366;

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Janela a partir de datas de calendário. Entrada inválida cai em "hoje";
 * datas futuras são cortadas em hoje; a janela é limitada a um ano.
 */
export function resolveProductSalesWindow(
  input: { from?: string | null; to?: string | null },
  now: Date = new Date(),
): ProductSalesWindow {
  const today = formatBrtCalendarDate(now);
  let fromDate = isCalendarDate(input.from) ? input.from : today;
  let throughDate = isCalendarDate(input.to) ? input.to : fromDate;
  if (fromDate > throughDate) [fromDate, throughDate] = [throughDate, fromDate];
  if (throughDate > today) throughDate = today;
  if (fromDate > today) fromDate = today;
  const floor = shiftCalendarDate(throughDate, -(MAX_WINDOW_DAYS - 1));
  if (fromDate < floor) fromDate = floor;

  return {
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
  productTitle: string;
  buyerName: string;
  buyerEmail: string;
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
  netCentavos: number;
  salesCount: number;
};

/** Uma venda aprovada no período, já com o balde da série a que pertence. */
export type ProductSalesItem = {
  orderId: string;
  bucketKey: string;
  approvedAt: string;
  productTitle: string;
  buyerName: string;
  buyerEmail: string;
  method: ProductSalesMethod;
  orderStatus: ProductSalesOrderStatus;
  paymentStatus: string | null;
  grossCentavos: number;
  netCentavos: number;
};

export type ProductSalesDashboard = {
  summary: ProductSalesSummary;
  series: ProductSalesPoint[];
  /** Ordenadas da mais recente para a mais antiga. */
  sales: ProductSalesItem[];
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
        netCentavos: 0,
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
    points.push({
      key: date,
      label: `${day}/${month}`,
      grossCentavos: 0,
      netCentavos: 0,
      salesCount: 0,
    });
  }
  return points;
}

export function buildProductSalesDashboard(
  rows: ProductSalesOrderRow[],
  window: ProductSalesWindow,
): ProductSalesDashboard {
  const series = emptySeries(window);
  const seriesByKey = new Map(series.map((point) => [point.key, point]));
  const sales: ProductSalesItem[] = [];

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
      const net = resolveNetCentavos(row);
      grossCentavos += gross;
      netCentavos += net;
      if (row.paymentStatus === "charged_back") chargebackCount += 1;
      const key = bucketKey(row.approvedAt as Date, window);
      const point = seriesByKey.get(key);
      if (point) {
        point.grossCentavos += gross;
        point.netCentavos += net;
        point.salesCount += 1;
      }
      sales.push({
        orderId: row.orderId,
        bucketKey: key,
        approvedAt: (row.approvedAt as Date).toISOString(),
        productTitle: row.productTitle,
        buyerName: row.buyerName,
        buyerEmail: row.buyerEmail,
        method: classifyProductSalesMethod(row),
        orderStatus: row.orderStatus,
        paymentStatus: row.paymentStatus,
        grossCentavos: gross,
        netCentavos: net,
      });
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
    sales: sales.sort((a, b) => b.approvedAt.localeCompare(a.approvedAt)),
  };
}
