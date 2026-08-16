import {
  Banknote,
  CreditCard,
  History,
  Landmark,
  TrendingUp,
} from "lucide-react";
import type { FinanceDashboardSummary } from "@/lib/backoffice/finance-dashboard";
import type { DashboardDateWindow } from "@/lib/backoffice/dashboard-date-range";
import type { FinancePaymentSource } from "@/lib/backoffice/finance-search-params";
import {
  formatBRLFromCentavos,
  formatCalendarDateLabel,
  formatFinanceNumber,
  formatFinancePercentage,
} from "@/lib/backoffice/finance-format";
import { FinanceDateFilter } from "./finance-date-filter";

type FinanceOverviewProps = {
  summary: FinanceDashboardSummary;
  window: DashboardDateWindow;
  source: FinancePaymentSource;
};

type FinanceRailProps = {
  label: string;
  description: string;
  netCentavos: number;
  totalNetCentavos: number;
  icon: typeof CreditCard;
  tone: "card" | "pix" | "manual";
};

function FinanceRail({
  label,
  description,
  netCentavos,
  totalNetCentavos,
  icon: Icon,
  tone,
}: FinanceRailProps) {
  const share =
    totalNetCentavos === 0
      ? 0
      : Math.round((netCentavos / totalNetCentavos) * 1000) / 10;
  const barClass =
    tone === "pix"
      ? "bg-emerald-500/80"
      : tone === "manual"
        ? "bg-amber-500/80"
        : "bg-chart-1";

  return (
    <div className="grid gap-3 py-4 sm:grid-cols-[minmax(150px,0.6fr)_minmax(0,1.4fr)_auto] sm:items-center">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
          <Icon className="size-3.5" />
        </span>
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-[11px] text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="min-w-0">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${barClass}`}
            style={{ width: `${share}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
          {formatFinancePercentage(share)}% do recebido líquido
        </p>
      </div>
      <p className="text-left text-sm font-semibold tabular-nums sm:text-right">
        {formatBRLFromCentavos(netCentavos)}
      </p>
    </div>
  );
}

export function FinanceOverview({
  summary,
  window,
  source,
}: FinanceOverviewProps) {
  const netIsComplete =
    summary.receipts.netCoveragePayments === summary.receipts.payments;
  const averageTicketCentavos =
    summary.activeSubscriptions > 0
      ? Math.round(summary.mrrCentavos / summary.activeSubscriptions)
      : 0;
  const providers = [
    {
      ...summary.receipts.providers.card,
      label: "Cartão",
      description: "Stripe",
      icon: CreditCard,
      tone: "card" as const,
    },
    {
      ...summary.receipts.providers.pix,
      label: "PIX",
      description: "Mercado Pago",
      icon: Landmark,
      tone: "pix" as const,
    },
    {
      ...summary.receipts.providers.manual,
      label: "Manual",
      description: "Fora dos gateways",
      icon: Banknote,
      tone: "manual" as const,
    },
  ].filter((provider) => provider.payments > 0);

  return (
    <div className="space-y-8">
      <section aria-labelledby="finance-base-heading" className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="finance-base-heading" className="text-base font-semibold">
              Visão da base
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Indicadores atuais e históricos da carteira de clientes.
            </p>
          </div>
          <span className="w-fit rounded-full border bg-muted/40 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
            Sem filtro de período
          </span>
        </div>

        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="divide-y lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] lg:divide-x lg:divide-y-0">
            <div className="p-5 sm:p-6">
              <div className="flex size-9 items-center justify-center rounded-full border bg-background text-muted-foreground">
                <TrendingUp className="size-4" />
              </div>
              <p className="mt-6 text-xs font-medium text-muted-foreground">
                MRR atual
              </p>
              <strong className="mt-1 block text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
                {formatBRLFromCentavos(summary.mrrCentavos)}
              </strong>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Receita mensal normalizada dos{" "}
                {formatFinanceNumber(summary.activeSubscriptions)} planos
                ativos, incluindo contratos anuais e acessos PIX vigentes.
              </p>

              <dl className="mt-6 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4 sm:divide-x">
                <div className="sm:pr-3">
                  <dt className="text-[10px] text-muted-foreground">Cartão</dt>
                  <dd className="mt-1 text-xs font-semibold tabular-nums sm:text-sm">
                    {formatBRLFromCentavos(summary.mrrByProvider.card)}
                  </dd>
                </div>
                <div className="sm:px-3">
                  <dt className="text-[10px] text-muted-foreground">PIX</dt>
                  <dd className="mt-1 text-xs font-semibold tabular-nums sm:text-sm">
                    {formatBRLFromCentavos(summary.mrrByProvider.pix)}
                  </dd>
                </div>
                <div className="sm:px-3">
                  <dt className="text-[10px] text-muted-foreground">Manual</dt>
                  <dd className="mt-1 text-xs font-semibold tabular-nums sm:text-sm">
                    {formatBRLFromCentavos(summary.mrrByProvider.manual)}
                  </dd>
                </div>
                <div className="sm:pl-3">
                  <dt className="text-[10px] text-muted-foreground">
                    Ticket médio
                  </dt>
                  <dd className="mt-1 text-xs font-semibold tabular-nums sm:text-sm">
                    {formatBRLFromCentavos(averageTicketCentavos)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="p-5 sm:p-6">
              <div className="flex size-9 items-center justify-center rounded-full border bg-background text-muted-foreground">
                <History className="size-4" />
              </div>
              <p className="mt-6 text-xs font-medium text-muted-foreground">
                LTV histórico
              </p>
              <strong className="mt-1 block text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
                {formatBRLFromCentavos(summary.realizedLtvCentavos)}
              </strong>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Receita aprovada desde o primeiro pagamento, dividida por todos
                os clientes que já pagaram.
              </p>

              <dl className="mt-6 border-t pt-4">
                <div>
                  <dt className="text-[10px] text-muted-foreground">
                    Clientes pagantes históricos
                  </dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums">
                    {formatFinanceNumber(summary.lifetimePayingCustomers)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="finance-period-heading" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              id="finance-period-heading"
              className="text-base font-semibold"
            >
              Movimentação no período
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              O filtro afeta somente os recebimentos abaixo.
            </p>
          </div>
          <FinanceDateFilter window={window} tab="visao" source={source} />
        </div>

        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="p-5 sm:p-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Recebido líquido no período
                </p>
                <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
                  {formatBRLFromCentavos(summary.receipts.netCentavos)}
                </p>
              </div>
              <div className="text-xs text-muted-foreground sm:text-right">
                <p>
                  {formatCalendarDateLabel(window.fromDate)} a{" "}
                  {formatCalendarDateLabel(window.throughDate)}
                </p>
                <p>
                  {formatFinanceNumber(summary.receipts.payments)} pagamentos
                  aprovados
                </p>
              </div>
            </div>

            {!netIsComplete ? (
              <p className="mt-3 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                O total líquido está parcial porque o gateway ainda não informou
                as taxas de alguns pagamentos.
              </p>
            ) : null}
          </div>

          <div className="divide-y border-t px-5 sm:px-6">
            {providers.map((provider) => (
              <FinanceRail
                key={provider.provider}
                label={provider.label}
                description={provider.description}
                netCentavos={provider.netCentavos}
                totalNetCentavos={summary.receipts.netCentavos}
                icon={provider.icon}
                tone={provider.tone}
              />
            ))}
          </div>
        </div>
      </section>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        O recebido considera apenas pagamentos aprovados no período; trials não
        entram. Valores líquidos podem ficar parciais enquanto o gateway ainda
        não informou todas as taxas.
      </p>
    </div>
  );
}
