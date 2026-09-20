"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RETENTION_REASON_LABELS,
  VALID_CANCELLATION_STATS_PLANS,
  VALID_CANCELLATION_STATS_PROVIDERS,
  type CancellationStatsFilters,
  type CancellationStatsSummary,
} from "@/lib/backoffice/cancellation-stats";
import type { DashboardDateWindow } from "@/lib/backoffice/dashboard-date-range";
import { useDashboardNavigation } from "./dashboard-navigation-feedback";
import { DashboardDateFilter } from "./dashboard-date-filter";

const chartConfig = {
  attempts: { label: "Tentativas", color: "var(--chart-1)" },
} satisfies ChartConfig;

const providerLabels: Record<(typeof VALID_CANCELLATION_STATS_PROVIDERS)[number], string> = {
  stripe: "Stripe",
  mercadopago: "Mercado Pago",
  manual: "Manual",
};

const planLabels: Record<(typeof VALID_CANCELLATION_STATS_PLANS)[number], string> = {
  monthly_starter: "Mensal Starter",
  monthly_pro: "Mensal Pro",
  monthly_premium: "Mensal Premium",
  quarterly_starter: "Trimestral Starter",
  quarterly_pro: "Trimestral Pro",
  quarterly_premium: "Trimestral Premium",
  semiannual_starter: "Semestral Starter",
  semiannual_pro: "Semestral Pro",
  semiannual_premium: "Semestral Premium",
  annual_starter: "Anual Starter",
  annual_pro: "Anual Pro",
  annual_premium: "Anual Premium",
};

const numberFormatter = new Intl.NumberFormat("pt-BR");
const percentageFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

function number(value: number) {
  return numberFormatter.format(value);
}

function rateLabel(value: { numerator: number; denominator: number; percent: number }) {
  return `${number(value.numerator)} / ${number(value.denominator)} · ${percentageFormatter.format(value.percent)}%`;
}

function buildFilterHref(
  window: DashboardDateWindow,
  filters: CancellationStatsFilters,
) {
  const params = new URLSearchParams({
    tab: "retencao",
    range: window.preset,
    from: window.fromDate,
    to: window.throughDate,
  });
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.planType) params.set("plan", filters.planType);
  return `/?${params.toString()}`;
}

function MetricCard({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export function CancellationStatsPanel({
  summary,
  window,
  filters,
}: {
  summary: CancellationStatsSummary;
  window: DashboardDateWindow;
  filters: CancellationStatsFilters;
}) {
  const { navigate } = useDashboardNavigation();
  const chartData = summary.reasons.map((row) => ({
    reason: row.reason,
    label: RETENTION_REASON_LABELS[row.reason],
    attempts: row.attempts,
  }));

  function setFilter(key: "provider" | "planType", value: string) {
    const next = { ...filters };
    if (key === "provider") {
      next.provider = value === "all" ? undefined : (value as CancellationStatsFilters["provider"]);
    } else {
      next.planType = value === "all" ? undefined : (value as CancellationStatsFilters["planType"]);
    }
    navigate(buildFilterHref(window, next));
  }

  return (
    <section aria-labelledby="cancellation-stats-title" className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 id="cancellation-stats-title" className="text-base font-semibold">
            Motivos e desfechos do cancelamento
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Tentativas distintas iniciadas no período. Retenção efetiva exige 30 dias,
            acesso válido e pagamento confirmado quando a renovação já venceu.
          </p>
        </div>
        <DashboardDateFilter
          basePath="/"
          window={window}
          extraParams={{
            tab: "retencao",
            ...(filters.provider ? { provider: filters.provider } : {}),
            ...(filters.planType ? { plan: filters.planType } : {}),
          }}
          label="Início da tentativa"
          className="w-full lg:w-64"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Cancelamento concluído"
          value={`${percentageFormatter.format(summary.completed.percent)}%`}
          description={`${rateLabel(summary.completed)} das tentativas`}
        />
        <MetricCard
          label="Cancelamento agendado"
          value={`${percentageFormatter.format(summary.scheduled.percent)}%`}
          description={`${rateLabel(summary.scheduled)} das tentativas`}
        />
        <MetricCard
          label="Retenção efetiva em 30 dias"
          value={`${percentageFormatter.format(summary.effectiveRetention30d.percent)}%`}
          description={`${rateLabel(summary.effectiveRetention30d)} das maduras`}
        />
        <MetricCard
          label="Aceites ainda imaturos"
          value={number(summary.immatureAcceptedAttempts)}
          description="aguardando completar 30 dias"
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Select value={filters.provider ?? "all"} onValueChange={(value) => setFilter("provider", value)}>
          <SelectTrigger aria-label="Filtrar por provedor" className="w-full sm:w-52">
            <SelectValue placeholder="Todos os provedores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os provedores</SelectItem>
            {VALID_CANCELLATION_STATS_PROVIDERS.map((provider) => (
              <SelectItem key={provider} value={provider}>{providerLabels[provider]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.planType ?? "all"} onValueChange={(value) => setFilter("planType", value)}>
          <SelectTrigger aria-label="Filtrar por plano" className="w-full sm:w-64">
            <SelectValue placeholder="Todos os planos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os planos</SelectItem>
            {VALID_CANCELLATION_STATS_PLANS.map((plan) => (
              <SelectItem key={plan} value={plan}>{planLabels[plan]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(22rem,1fr)]">
        <div className="rounded-xl border bg-card p-4 shadow-xs sm:p-5">
          <div>
            <h3 className="text-sm font-semibold">Distribuição dos motivos</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {number(summary.reasons.reduce((total, row) => total + row.attempts, 0))} tentativas com motivo registrado
            </p>
          </div>
          <ChartContainer config={chartConfig} className="mt-4 h-[260px] w-full">
            <BarChart accessibilityLayer data={chartData} layout="vertical" margin={{ left: 4, right: 12 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" allowDecimals={false} hide />
              <YAxis
                type="category"
                dataKey="label"
                width={150}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
              />
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <Bar dataKey="attempts" fill="var(--color-attempts)" radius={4} maxBarSize={28} />
            </BarChart>
          </ChartContainer>
        </div>

        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="border-b px-4 py-4 sm:px-5">
            <h3 className="text-sm font-semibold">Ofertas exibidas e aceitas</h3>
            <p className="mt-1 text-xs text-muted-foreground">Numerador / denominador por tipo de oferta</p>
          </div>
          <div className="divide-y">
            {summary.offers.map((offer) => (
              <div key={offer.kind} className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
                <div>
                  <p className="text-sm font-medium">{offer.kind === "discount" ? "Desconto" : "Especialista"}</p>
                  <p className="text-xs text-muted-foreground">{number(offer.shown)} exibidas</p>
                </div>
                <p className="font-mono text-sm tabular-nums">{rateLabel(offer.accepted)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">Distribuição de motivos por tentativa</caption>
          <thead className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
            <tr><th className="px-4 py-3 font-medium">Motivo</th><th className="px-4 py-3 text-right font-medium">Tentativas</th><th className="px-4 py-3 text-right font-medium">Participação</th></tr>
          </thead>
          <tbody className="divide-y">
            {summary.reasons.map((row) => (
              <tr key={row.reason}>
                <td className="px-4 py-3">{row.label}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{number(row.attempts)}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{rateLabel(row.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
