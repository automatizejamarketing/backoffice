"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Ban,
  CircleDollarSign,
  CreditCard,
  Hash,
  QrCode,
  TrendingUp,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { FilterBar, FilterSelect } from "@/components/ui/filter";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PRODUCT_SALES_PERIOD_LABELS,
  PRODUCT_SALES_PERIOD_VALUES,
  type ProductSalesDashboard,
  type ProductSalesPeriod,
  type ProductSalesWindow,
} from "@/lib/backoffice/product-sales-dashboard";
import {
  formatBRLFromCentavos,
  formatFinanceNumber,
  formatFinancePercentage,
} from "@/lib/backoffice/finance-format";
import { formatCalendarDateLabel } from "@/lib/backoffice/datetime-format";
import { cn } from "@/lib/utils";

type SalesDashboardResponse = ProductSalesDashboard & {
  window: Pick<ProductSalesWindow, "period" | "fromDate" | "throughDate" | "bucket">;
  productId: string | null;
  products: Array<{ id: string; title: string }>;
};

const ALL_PRODUCTS = "all";

async function fetchSalesDashboard(
  period: ProductSalesPeriod,
  productId: string,
): Promise<SalesDashboardResponse> {
  const params = new URLSearchParams({ period });
  if (productId !== ALL_PRODUCTS) params.set("productId", productId);
  const response = await fetch(
    `/api/products/admin/sales-dashboard?${params.toString()}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`Falha ao carregar vendas (${response.status})`);
  }
  return (await response.json()) as SalesDashboardResponse;
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${formatFinancePercentage(value)} %`;
}

function formatAxisBRL(centavos: number) {
  const reais = centavos / 100;
  if (reais >= 1000) return `R$ ${formatFinanceNumber(Math.round(reais / 100) / 10)}k`;
  return `R$ ${formatFinanceNumber(Math.round(reais))}`;
}

/**
 * Painel de vendas dos produtos digitais. É o mesmo componente no Painel
 * (aba "Vendas de produtos") e em Produtos (aba "Painel"): os filtros vivem
 * aqui dentro para as duas telas se comportarem igual.
 */
export function ProductSalesPanel() {
  const [period, setPeriod] = useState<ProductSalesPeriod>("today");
  const [productId, setProductId] = useState(ALL_PRODUCTS);

  const query = useQuery({
    queryKey: ["product-sales-dashboard", period, productId],
    queryFn: () => fetchSalesDashboard(period, productId),
    placeholderData: (previous) => previous,
  });

  const data = query.data;
  const summary = data?.summary;
  const stale = query.isPlaceholderData || query.isFetching;

  return (
    <section aria-labelledby="product-sales-title" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="product-sales-title" className="text-base font-semibold">
            Vendas de produtos
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {data
              ? data.window.fromDate === data.window.throughDate
                ? formatCalendarDateLabel(data.window.fromDate)
                : `${formatCalendarDateLabel(data.window.fromDate)} a ${formatCalendarDateLabel(data.window.throughDate)}`
              : "Carregando período…"}
            {" · "}valores em BRL
          </p>
        </div>
        <FilterBar
          activeCount={productId === ALL_PRODUCTS ? 0 : 1}
          onClear={() => setProductId(ALL_PRODUCTS)}
        >
          <FilterSelect
            label="Período"
            value={period}
            onValueChange={(value) =>
              setPeriod(value ? (value as ProductSalesPeriod) : "today")
            }
            options={PRODUCT_SALES_PERIOD_VALUES.map((value) => ({
              value,
              label: PRODUCT_SALES_PERIOD_LABELS[value],
            }))}
          />
          <FilterSelect
            label="Produto"
            value={productId === ALL_PRODUCTS ? undefined : productId}
            onValueChange={(value) => setProductId(value ?? ALL_PRODUCTS)}
            options={(data?.products ?? []).map((item) => ({
              value: item.id,
              label: item.title,
            }))}
            allLabel="Todos os produtos"
            className="max-w-72"
          />
        </FilterBar>
      </div>

      {query.isError ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
        >
          Não deu para carregar as vendas.{" "}
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => void query.refetch()}
          >
            Tentar de novo
          </button>
        </div>
      ) : null}

      <div
        aria-busy={stale}
        className={cn(
          "grid gap-4 lg:grid-cols-2 transition-opacity",
          stale && "opacity-60",
        )}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border bg-card p-4 shadow-xs sm:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs font-medium text-muted-foreground">
                Faturamento bruto
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {summary ? formatBRLFromCentavos(summary.grossCentavos) : "—"}
              </p>
            </div>
            <div className="mt-3">
              {data ? (
                <SalesChart data={data} />
              ) : (
                <Skeleton className="h-[220px] w-full" />
              )}
            </div>
          </div>
          <StatCard
            icon={CreditCard}
            label="Aprovação cartão"
            value={summary ? formatPercent(summary.cardApprovalPercent) : null}
            detail={
              summary
                ? `${formatFinanceNumber(summary.cardApproved)} de ${formatFinanceNumber(summary.cardDecided)} cartões respondidos`
                : undefined
            }
          />
          <StatCard
            icon={Undo2}
            label="Reembolso"
            value={summary ? formatPercent(summary.refundPercent) : null}
            detail={
              summary
                ? `${formatFinanceNumber(summary.refundCount)} no período`
                : undefined
            }
          />
          <StatCard
            icon={Ban}
            label="Chargeback"
            value={summary ? formatPercent(summary.chargebackPercent) : null}
            detail={
              summary
                ? `${formatFinanceNumber(summary.chargebackCount)} no período`
                : undefined
            }
          />
        </div>

        <div className="flex flex-col gap-4">
          <StatCard
            icon={CircleDollarSign}
            label="Valor líquido"
            value={summary ? formatBRLFromCentavos(summary.netCentavos) : null}
            detail="Parte da Automatize, já descontados gateway e expert"
          />
          <StatCard
            icon={TrendingUp}
            label="Vendas"
            value={summary ? formatFinanceNumber(summary.salesCount) : null}
            detail="Pedidos aprovados no período"
          />
          <StatCard
            icon={QrCode}
            label="Conversão Pix"
            value={summary ? formatPercent(summary.pixConversionPercent) : null}
            detail={
              summary
                ? `${formatFinanceNumber(summary.pixApproved)} pagos de ${formatFinanceNumber(summary.pixGenerated)} gerados`
                : undefined
            }
          />
          <StatCard
            icon={Hash}
            label="Pix gerados"
            value={summary ? formatFinanceNumber(summary.pixGenerated) : null}
            detail="Pedidos com Pix criados no período"
          />
        </div>
      </div>
    </section>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string | null;
  detail?: string;
}) {
  return (
    <div className="flex items-start gap-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {value === null ? (
          <Skeleton className="mt-1.5 h-7 w-24" />
        ) : (
          <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">
            {value}
          </p>
        )}
        {detail ? (
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const chartConfig = {
  grossCentavos: { label: "Faturamento", color: "var(--chart-1)" },
} satisfies ChartConfig;

const subscribeToClient = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function SalesChart({ data }: { data: SalesDashboardResponse }) {
  const mounted = useSyncExternalStore(
    subscribeToClient,
    getClientSnapshot,
    getServerSnapshot,
  );
  if (!mounted) return <div className="h-[220px] w-full" aria-hidden />;

  return (
    <ChartContainer config={chartConfig} className="h-[220px] w-full">
      <LineChart
        accessibilityLayer
        data={data.series}
        margin={{ top: 8, right: 8, bottom: 0, left: 4 }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          width={56}
          tickFormatter={(value: number) => formatAxisBRL(value)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, _name, item) => {
                const point = (item as { payload?: { salesCount?: number } })
                  .payload;
                const sales = point?.salesCount ?? 0;
                return (
                  <span className="flex w-full items-center justify-between gap-4 tabular-nums">
                    <span className="text-muted-foreground">
                      {formatFinanceNumber(sales)} {sales === 1 ? "venda" : "vendas"}
                    </span>
                    <span className="font-medium">
                      {formatBRLFromCentavos(Number(value))}
                    </span>
                  </span>
                );
              }}
            />
          }
        />
        <Line
          type="monotone"
          dataKey="grossCentavos"
          stroke="var(--color-grossCentavos)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
