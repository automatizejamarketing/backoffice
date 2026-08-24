import { Info } from "lucide-react";
import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TRIAL_DAILY_GOAL,
  formatActivationDelay,
  goalStatus,
  type DailyTrialActivation,
  type GoalStatus,
  type TrialActivationDashboard,
} from "@/lib/backoffice/trial-activation";
import {
  formatInSaoPaulo,
  parseCalendarDate,
} from "@/lib/backoffice/datetime-format";
import { cn } from "@/lib/utils";
import { TrialActivationChart } from "./trial-activation-chart";

const numberFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatCalendarDate(value: string) {
  return formatInSaoPaulo(parseCalendarDate(value), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTableDate(value: string) {
  return formatInSaoPaulo(parseCalendarDate(value), {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

const GOAL_LABEL = `${TRIAL_DAILY_GOAL.min}–${TRIAL_DAILY_GOAL.max}`;

const GOAL_STATUS_COPY: Record<GoalStatus, string> = {
  below: "abaixo da meta",
  on: "dentro da meta",
  above: "acima da meta",
};

function GoalDot({ status }: { status: GoalStatus }) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 rounded-full",
        status === "on" && "bg-chart-3",
        status === "above" && "bg-chart-5",
        status === "below" && "bg-border",
      )}
    >
      <span className="sr-only">{GOAL_STATUS_COPY[status]}</span>
    </span>
  );
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="p-4 sm:p-5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        <strong className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </strong>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {detail}
        </p>
      </dd>
    </div>
  );
}

function DailyTrialTable({ data }: { data: DailyTrialActivation[] }) {
  return (
    <div className="max-h-[480px] overflow-auto rounded-lg border">
      <Table className="min-w-[520px]">
        <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-10 whitespace-nowrap">Dia</TableHead>
            <TableHead className="h-10 whitespace-nowrap text-right">
              Trials
            </TableHead>
            <TableHead className="h-10 whitespace-nowrap text-right">
              Cadastro do dia
            </TableHead>
            <TableHead className="h-10 whitespace-nowrap text-right">
              Conta antiga
            </TableHead>
            <TableHead className="h-10 whitespace-nowrap text-right">
              Tempo até ativar
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...data].reverse().map((row) => (
            <TableRow key={row.date}>
              <TableCell className="py-3 font-medium whitespace-nowrap capitalize">
                {formatTableDate(row.date)}
              </TableCell>
              <TableCell className="py-3 text-right">
                <span className="inline-flex items-center gap-2">
                  <GoalDot status={goalStatus(row.activations)} />
                  <span className="font-mono font-medium tabular-nums">
                    {formatNumber(row.activations)}
                  </span>
                </span>
              </TableCell>
              <TableCell className="py-3 text-right font-mono tabular-nums">
                {formatNumber(row.sameDay)}
              </TableCell>
              <TableCell className="py-3 text-right font-mono tabular-nums">
                {formatNumber(row.existingAccount)}
              </TableCell>
              <TableCell className="py-3 text-right font-mono tabular-nums whitespace-nowrap">
                {formatActivationDelay(row.avgDelaySeconds)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function TrialActivationPanel({
  dashboard,
  dateFilter,
}: {
  dashboard: TrialActivationDashboard;
  dateFilter: ReactNode;
}) {
  const { daily, summary, window } = dashboard;

  return (
    <section aria-labelledby="trial-activation-title" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="trial-activation-title" className="text-sm font-semibold">
            Trials ativados por dia
          </h2>
          <p className="text-xs text-muted-foreground">
            {formatCalendarDate(window.fromDate)} a{" "}
            {formatCalendarDate(window.throughDate)} · contados no dia em que
            o trial começou, não no dia do cadastro
          </p>
        </div>
        {dateFilter}
      </div>

      <dl className="grid divide-y rounded-xl border bg-card shadow-xs sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        <Stat
          label="Trials ativados"
          value={formatNumber(summary.activations)}
          detail={`${formatNumber(summary.avgPerDay)} por dia · meta ${GOAL_LABEL}`}
        />
        <Stat
          label="Dias dentro da meta"
          value={`${formatNumber(summary.daysOnGoal)} de ${formatNumber(summary.days)}`}
          detail={`${formatNumber(summary.daysAboveGoal)} acima · ${formatNumber(summary.daysBelowGoal)} abaixo`}
        />
        <Stat
          label="Tempo médio até ativar"
          value={formatActivationDelay(summary.avgDelaySeconds)}
          detail={`Mediana ${formatActivationDelay(summary.medianDelaySeconds)} · do cadastro ao primeiro trial`}
        />
        <Stat
          label="Contas antigas"
          value={formatNumber(summary.existingAccount)}
          detail={`${formatNumber(summary.existingAccountRate)}% dos trials vieram de quem já tinha conta`}
        />
      </dl>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(600px,0.9fr)]">
        <div className="min-w-0 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
          <div className="mb-5">
            <h3 className="text-sm font-semibold">Evolução diária</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              A faixa tracejada é a meta interna de {GOAL_LABEL} trials por
              dia. Cada barra separa quem criou a conta naquele dia de quem já
              tinha conta.
            </p>
          </div>
          <TrialActivationChart data={daily} />
        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Detalhe por dia</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Tempo médio do cadastro até o trial entre quem ativou naquele
              dia. A mediana de cada dia está no gráfico, ao passar o mouse.
            </p>
          </div>
          <DailyTrialTable data={daily} />
        </div>
      </section>

      <aside className="flex items-start gap-2.5 rounded-lg border border-dashed bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <p>
          Um trial conta uma única vez, no dia em que a pessoa recebeu os
          créditos iniciais pela primeira vez — independentemente de quando
          criou a conta. Acessos liberados à mão pelo backoffice (ajuste de
          créditos e data de expiração) não passam por esse marco e não
          aparecem aqui.
        </p>
      </aside>
    </section>
  );
}
