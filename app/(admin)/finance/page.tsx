import { redirect } from "next/navigation";
import { Banknote, CreditCard, Landmark, TrendingUp } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/rbac";
import { canAccessFinance } from "@/lib/auth/finance-access";
import {
  resolveDashboardDateWindow,
  type DashboardDateSearchParams,
} from "@/lib/backoffice/dashboard-date-range";
import { getFinanceDashboard } from "@/lib/db/admin-queries";
import { DashboardDateFilter } from "../dashboard-date-filter";

export const dynamic = "force-dynamic";

const numberFormatter = new Intl.NumberFormat("pt-BR");
const percentageFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatPercentage(value: number) {
  return `${percentageFormatter.format(value)}%`;
}

function formatBRLFromCentavos(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function parseCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function formatCalendarDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(parseCalendarDate(value));
}

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
          {formatPercentage(share)} do recebido líquido
        </p>
      </div>
      <p className="text-left text-sm font-semibold tabular-nums sm:text-right">
        {formatBRLFromCentavos(netCentavos)}
      </p>
    </div>
  );
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<DashboardDateSearchParams>;
}) {
  const [actor, params] = await Promise.all([
    requirePagePermission("finance:view", "/"),
    searchParams,
  ]);
  if (!canAccessFinance(actor.email)) redirect("/");

  const window = resolveDashboardDateWindow(params);
  const finance = await getFinanceDashboard(window);
  const { summary } = finance;
  const netIsComplete =
    summary.receipts.netCoveragePayments === summary.receipts.payments;
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
    <div className="mx-auto w-full max-w-[1500px] space-y-8">
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Receita recorrente e caixa
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Financeiro
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Acompanhe o MRR atual e quanto entrou líquido em cada meio de
            pagamento no período selecionado.
          </p>
        </div>

        <DashboardDateFilter basePath="/finance" window={window} />
      </header>

      <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="p-5 sm:p-6">
          <div className="flex size-9 items-center justify-center rounded-full border bg-background text-muted-foreground">
            <TrendingUp className="size-4" />
          </div>
          <p className="mt-6 text-xs font-medium text-muted-foreground">
            MRR da base ativa
          </p>
          <strong className="mt-1 block text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
            {formatBRLFromCentavos(summary.mrrCentavos)}
          </strong>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Receita mensal normalizada dos {formatNumber(summary.activeSubscriptions)} planos
            ativos, incluindo contratos anuais e acessos PIX vigentes.
          </p>

          <dl className="mt-6 grid grid-cols-3 divide-x border-t pt-4">
            <div className="pr-3">
              <dt className="text-[10px] text-muted-foreground">Cartão</dt>
              <dd className="mt-1 text-xs font-semibold tabular-nums sm:text-sm">
                {formatBRLFromCentavos(summary.mrrByProvider.card)}
              </dd>
            </div>
            <div className="px-3">
              <dt className="text-[10px] text-muted-foreground">PIX</dt>
              <dd className="mt-1 text-xs font-semibold tabular-nums sm:text-sm">
                {formatBRLFromCentavos(summary.mrrByProvider.pix)}
              </dd>
            </div>
            <div className="pl-3">
              <dt className="text-[10px] text-muted-foreground">Manual</dt>
              <dd className="mt-1 text-xs font-semibold tabular-nums sm:text-sm">
                {formatBRLFromCentavos(summary.mrrByProvider.manual)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="border-t p-5 sm:p-6">
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
                {formatCalendarDate(window.fromDate)} a{" "}
                {formatCalendarDate(window.throughDate)}
              </p>
              <p>{formatNumber(summary.receipts.payments)} pagamentos aprovados</p>
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
      </section>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        MRR não é caixa: ele normaliza mensalmente os planos ativos. O recebido
        considera apenas pagamentos aprovados no período; trials não entram.
      </p>
    </div>
  );
}
