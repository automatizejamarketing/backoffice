import { Info } from "lucide-react";
import type { ReactNode } from "react";
import {
  TRIAL_DAILY_GOAL,
  formatActivationDelay,
  type TrialActivationDashboard,
} from "@/lib/backoffice/trial-activation";
import {
  formatInSaoPaulo,
  parseCalendarDate,
} from "@/lib/backoffice/datetime-format";
import { TrialActivationExplorer } from "./trial-activation-explorer";

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

const GOAL_LABEL = `${TRIAL_DAILY_GOAL.min}–${TRIAL_DAILY_GOAL.max}`;

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

      <TrialActivationExplorer daily={daily} />

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
