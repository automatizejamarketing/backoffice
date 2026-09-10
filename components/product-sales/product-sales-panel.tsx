"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Ban,
  CreditCard,
  Hash,
  QrCode,
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
import {
  DateRangePicker,
  type DateRange,
} from "@/components/ui/date-range-picker";
import { FilterBar } from "@/components/ui/filter";
import { MultiSelect } from "@/components/ui/multi-select";
import { Skeleton } from "@/components/ui/skeleton";
import { dateKey } from "@/lib/dates";
import type {
  ProductSalesDashboard,
  ProductSalesWindow,
} from "@/lib/backoffice/product-sales-dashboard";
import {
  formatBRLFromCentavos,
  formatFinanceNumber,
  formatFinancePercentage,
} from "@/lib/backoffice/finance-format";
import { formatCalendarDateLabel } from "@/lib/backoffice/datetime-format";
import { cn } from "@/lib/utils";

type SalesDashboardResponse = ProductSalesDashboard & {
  window: Pick<ProductSalesWindow, "fromDate" | "throughDate" | "bucket">;
  productIds: string[];
  products: Array<{ id: string; title: string }>;
};

function todayRange(): DateRange {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { from: today, to: today };
}

async function fetchSalesDashboard(
  from: string,
  to: string,
  productIds: string[],
): Promise<SalesDashboardResponse> {
  const params = new URLSearchParams({ from, to });
  if (productIds.length > 0) params.set("productIds", productIds.join(","));
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
  if (reais >= 1000) {
    return `R$ ${formatFinanceNumber(Math.round(reais / 100) / 10)}k`;
  }
  return `R$ ${formatFinanceNumber(Math.round(reais))}`;
}

function describeWindow(window: SalesDashboardResponse["window"]) {
  return window.fromDate === window.throughDate
    ? formatCalendarDateLabel(window.fromDate)
    : `${formatCalendarDateLabel(window.fromDate)} a ${formatCalendarDateLabel(window.throughDate)}`;
}

/**
 * Painel de vendas dos produtos digitais. É o mesmo componente no Painel
 * (aba "Vendas de produtos") e em Produtos (aba "Painel"): os filtros vivem
 * aqui dentro para as duas telas se comportarem igual.
 */
export function ProductSalesPanel() {
  const [range, setRange] = useState<DateRange>(todayRange);
  const [productIds, setProductIds] = useState<string[]>([]);
  const from = dateKey(range.from);
  const to = dateKey(range.to);

  const query = useQuery({
    queryKey: ["product-sales-dashboard", from, to, productIds],
    queryFn: () => fetchSalesDashboard(from, to, productIds),
    placeholderData: (previous) => previous,
  });

  const data = query.data;
  const summary = data?.summary;
  const stale = query.isPlaceholderData || query.isFetching;

  return (
    <section aria-labelledby="product-sales-title" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="product-sales-title" className="text-base font-semibold">
          Vendas de produtos
        </h2>
        <FilterBar
          activeCount={productIds.length}
          onClear={() => setProductIds([])}
        >
          <DateRangePicker
            label="Período"
            value={range}
            maxDate={new Date()}
            onChange={(next) => setRange(next ?? todayRange())}
            className="w-full sm:w-64"
          />
          <MultiSelect
            label="Produto"
            options={(data?.products ?? []).map((item) => ({
              value: item.id,
              label: item.title,
            }))}
            value={productIds}
            onValueChange={setProductIds}
            allLabel="Todos os produtos"
            searchPlaceholder="Buscar produto…"
            className="w-full sm:w-72"
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
        className={cn("space-y-4 transition-opacity", stale && "opacity-60")}
      >
        <div className="rounded-xl border bg-card p-5 shadow-xs sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Valor líquido
              </p>
              {summary ? (
                <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
                  {formatBRLFromCentavos(summary.netCentavos)}
                </p>
              ) : (
                <Skeleton className="mt-2 h-11 w-56 sm:h-12" />
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Parte da Automatize, já descontados gateway e expert
                {data ? ` · ${describeWindow(data.window)}` : null}
              </p>
            </div>
            <dl className="flex gap-8">
              <div>
                <dt className="text-xs text-muted-foreground">Vendas</dt>
                <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                  {summary ? formatFinanceNumber(summary.salesCount) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  Faturamento bruto
                </dt>
                <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                  {summary ? formatBRLFromCentavos(summary.grossCentavos) : "—"}
                </dd>
              </div>
            </dl>
          </div>
          <div className="mt-6">
            {data ? (
              <SalesChart data={data} />
            ) : (
              <Skeleton className="h-[240px] w-full" />
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            icon={CreditCard}
            label="Aprovação cartão"
            value={summary ? formatPercent(summary.cardApprovalPercent) : null}
            detail={
              summary
                ? `${formatFinanceNumber(summary.cardApproved)} de ${formatFinanceNumber(summary.cardDecided)} respondidos`
                : undefined
            }
          />
          <StatCard
            icon={QrCode}
            label="Conversão Pix"
            value={summary ? formatPercent(summary.pixConversionPercent) : null}
            detail={
              summary
                ? `${formatFinanceNumber(summary.pixApproved)} pagos de ${formatFinanceNumber(summary.pixGenerated)}`
                : undefined
            }
          />
          <StatCard
            icon={Hash}
            label="Pix gerados"
            value={summary ? formatFinanceNumber(summary.pixGenerated) : null}
            detail="Pedidos com Pix criados no período"
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
    <div className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {value === null ? (
          <Skeleton className="mt-1.5 h-7 w-20" />
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
  netCentavos: { label: "Valor líquido", color: "var(--chart-1)" },
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
  if (!mounted) return <div className="h-[240px] w-full" aria-hidden />;

  return (
    <ChartContainer config={chartConfig} className="h-[240px] w-full">
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
                const point = (
                  item as {
                    payload?: { salesCount?: number; grossCentavos?: number };
                  }
                ).payload;
                return (
                  <div className="flex w-full flex-col gap-0.5 tabular-nums">
                    <span className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">Líquido</span>
                      <span className="font-medium">
                        {formatBRLFromCentavos(Number(value))}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">Bruto</span>
                      <span>{formatBRLFromCentavos(point?.grossCentavos ?? 0)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">Vendas</span>
                      <span>{formatFinanceNumber(point?.salesCount ?? 0)}</span>
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        <Line
          type="monotone"
          dataKey="netCentavos"
          stroke="var(--color-netCentavos)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
