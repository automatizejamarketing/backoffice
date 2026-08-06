import {
  ArrowDown,
  ArrowRight,
  BadgeCheck,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  CircleUserRound,
  FileText,
  Info,
  PlugZap,
  Sparkles,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getConversionDashboard,
  getCustomerBaseStatus,
  getDashboardStats,
} from "@/lib/db/admin-queries";
import type { DailyConversionCohort } from "@/lib/backoffice/conversion-dashboard";
import {
  resolveDashboardDateWindow,
  type DashboardDateSearchParams,
} from "@/lib/backoffice/dashboard-date-range";
import { requirePagePermission } from "@/lib/auth/rbac";
import { ConversionTrendChart } from "./conversion-trend-chart";
import { DashboardDateFilter } from "./dashboard-date-filter";
import {
  DashboardFetchingIndicator,
  DashboardNavigationProvider,
} from "./dashboard-navigation-feedback";
import { CustomerBaseStatusPanel } from "./customer-base-status";
import {
  formatInSaoPaulo,
  parseCalendarDate,
} from "@/lib/backoffice/datetime-format";

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

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCalendarDate(value: string, includeYear = false) {
  return formatInSaoPaulo(parseCalendarDate(value), {
    day: "2-digit",
    month: includeYear ? "short" : "2-digit",
    year: includeYear ? "numeric" : undefined,
  });
}

function rowRate(value: number, total: number) {
  if (total === 0) return "0%";
  return formatPercentage((value / total) * 100);
}

type JourneyStageProps = {
  step: number;
  label: string;
  description: string;
  value: number;
  rate: number;
  icon: typeof CircleUserRound;
  isFirst?: boolean;
  emphasis?: boolean;
};

function JourneyStage({
  step,
  label,
  description,
  value,
  rate,
  icon: Icon,
  isFirst = false,
  emphasis = false,
}: JourneyStageProps) {
  return (
    <div
      className={
        emphasis
          ? "relative min-w-0 flex-1 bg-chart-1/10 p-5 sm:p-6 dark:bg-chart-4/10"
          : "relative min-w-0 flex-1 p-5 sm:p-6"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex size-9 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs">
          <Icon className="size-4" />
        </div>
        <span className="font-mono text-[10px] font-medium tracking-[0.16em] text-muted-foreground">
          0{step}
        </span>
      </div>
      <p className="mt-5 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <strong className="text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
          {formatNumber(value)}
        </strong>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {isFirst ? "coorte" : `${formatPercentage(rate)} dos cadastros`}
        </span>
      </div>
      <p className="mt-3 max-w-[17rem] text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function JourneyConnector() {
  return (
    <div className="relative z-10 flex h-px items-center justify-center bg-border lg:h-auto lg:w-px">
      <span className="absolute flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs">
        <ArrowDown className="size-3 lg:hidden" />
        <ArrowRight className="hidden size-3 lg:block" />
      </span>
    </div>
  );
}

function DailyCohortTable({ data }: { data: DailyConversionCohort[] }) {
  return (
    <div className="max-h-[480px] overflow-auto rounded-lg border">
      <Table className="min-w-[720px]">
        <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-10">Dia de entrada</TableHead>
            <TableHead className="h-10 text-right">Criaram conta</TableHead>
            <TableHead className="h-10 text-right">
              Terminaram onboarding
            </TableHead>
            <TableHead className="h-10 text-right">Conectaram Meta</TableHead>
            <TableHead className="h-10 text-right">Pagaram</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...data].reverse().map((row) => (
            <TableRow key={row.date}>
              <TableCell className="py-3 font-medium">
                {formatCalendarDate(row.date, true)}
              </TableCell>
              <TableCell className="py-3 text-right font-mono tabular-nums">
                {formatNumber(row.newUsers)}
              </TableCell>
              <TableCell className="py-3 text-right">
                <span className="font-mono tabular-nums">
                  {formatNumber(row.onboardingCompleted)}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  ({rowRate(row.onboardingCompleted, row.newUsers)})
                </span>
              </TableCell>
              <TableCell className="py-3 text-right">
                <span className="font-mono tabular-nums">
                  {formatNumber(row.metaConnected)}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  ({rowRate(row.metaConnected, row.newUsers)})
                </span>
              </TableCell>
              <TableCell className="py-3 text-right">
                <span className="font-mono tabular-nums">
                  {formatNumber(row.paid)}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  ({rowRate(row.paid, row.newUsers)})
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardDateSearchParams>;
}) {
  const [, sp] = await Promise.all([
    requirePagePermission("dashboard:view"),
    searchParams,
  ]);
  const selectedWindow = resolveDashboardDateWindow(sp);
  const [conversion, stats, customerBaseStatus] = await Promise.all([
    getConversionDashboard(selectedWindow),
    getDashboardStats(),
    getCustomerBaseStatus(),
  ]);

  const { summary, daily, window, outcomes } = conversion;
  const platformStats = [
    {
      label: "Ativos com IA · 7 dias",
      value: formatNumber(stats.activeUsersLast7Days),
      icon: Sparkles,
    },
    {
      label: "Posts criados",
      value: formatNumber(stats.totalPosts),
      icon: FileText,
    },
    {
      label: "Requisições de IA",
      value: formatNumber(stats.totalRequests),
      icon: Bot,
    },
    {
      label: "Custo acumulado de IA",
      value: formatCurrency(stats.totalCost),
      icon: CircleDollarSign,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-8">
      <DashboardNavigationProvider>
        <header className="space-y-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-chart-3" />
              Conversão por coorte de entrada
            </div>
            <div className="mt-2 flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Do cadastro ao cliente
              </h1>
              <DashboardFetchingIndicator />
            </div>
          </div>

          <CustomerBaseStatusPanel status={customerBaseStatus} />

          <DashboardDateFilter basePath="/" window={window} />
        </header>
      </DashboardNavigationProvider>

      <section aria-labelledby="journey-title" className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="journey-title" className="text-sm font-semibold">
              Jornada da coorte
            </h2>
            <p className="text-xs text-muted-foreground">
              {formatCalendarDate(window.fromDate, true)} a{" "}
              {formatCalendarDate(window.throughDate, true)} · estado atual
              dessas pessoas
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Base: {formatNumber(summary.newUsers)} novos cadastros
          </p>
        </div>

        <div className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs lg:flex-row">
          <JourneyStage
            step={1}
            label="Criaram conta"
            value={summary.newUsers}
            rate={100}
            icon={CircleUserRound}
            description="Criaram uma conta dentro do período selecionado."
            isFirst
          />
          <JourneyConnector />
          <JourneyStage
            step={2}
            label="Terminaram onboarding"
            value={summary.onboardingCompleted}
            rate={summary.onboardingRate}
            icon={CheckCircle2}
            description="Concluíram o onboarding de uma empresa vinculada."
          />
          <JourneyConnector />
          <JourneyStage
            step={3}
            label="Conectaram Meta"
            value={summary.metaConnected}
            rate={summary.metaConnectionRate}
            icon={PlugZap}
            description="Possuem uma conta Meta conectada e disponível."
          />
          <JourneyConnector />
          <JourneyStage
            step={4}
            label="Pagaram"
            value={summary.paid}
            rate={summary.paidRate}
            icon={BadgeCheck}
            description="Têm ao menos um pagamento aprovado; trials não contam."
            emphasis
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border bg-card p-4 shadow-xs sm:p-5">
            <p className="text-xs font-medium text-muted-foreground">
              Em trial hoje
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <strong className="text-2xl font-semibold tracking-tight tabular-nums">
                {formatNumber(outcomes.trial)}
              </strong>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                {formatPercentage(outcomes.trialRate)} dos cadastros
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Cadastraram no período e ainda têm acesso vigente sem pagamento
              aprovado.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-xs sm:p-5">
            <p className="text-xs font-medium text-muted-foreground">
              Churnearam
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <strong className="text-2xl font-semibold tracking-tight tabular-nums">
                {formatNumber(outcomes.churn)}
              </strong>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                {formatPercentage(outcomes.churnRate)} dos cadastros
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Cadastraram no período, pagaram ao menos uma vez e já perderam o
              acesso.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(520px,0.85fr)]">
        <div className="min-w-0 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
          <div className="mb-5">
            <h2 className="text-sm font-semibold">Evolução diária</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Cada linha mantém o dia do cadastro como origem e mostra onde a
              coorte está hoje.
            </p>
          </div>
          <ConversionTrendChart data={daily} />
        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Detalhe por dia</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              O percentual usa os cadastros daquele dia como denominador.
            </p>
          </div>
          <DailyCohortTable data={daily} />
        </div>
      </section>

      <section className="space-y-3 border-t pt-6">
        <div>
          <h2 className="text-sm font-semibold">Contexto da plataforma</h2>
          <p className="text-xs text-muted-foreground">
            Indicadores acumulados para dar escala ao funil de aquisição.
          </p>
        </div>
        <div className="grid divide-y rounded-xl border bg-card sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          {platformStats.map((stat) => (
            <div key={stat.label} className="flex items-center gap-3 p-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <stat.icon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs text-muted-foreground">
                  {stat.label}
                </p>
                <p className="mt-0.5 text-lg font-semibold tracking-tight tabular-nums">
                  {stat.value}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <aside className="flex items-start gap-2.5 rounded-lg border border-dashed bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <p>
          Onboarding, conexão com a Meta e pagamento mostram o estado atual dos
          usuários que criaram conta no período — não o dia em que cada marco
          aconteceu.
        </p>
      </aside>
    </div>
  );
}
