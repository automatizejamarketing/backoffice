import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { PlaybookAlertComparison } from "@/lib/backoffice/playbook-alert-dashboard";
import { playbookAlertRuleTitle } from "@/lib/backoffice/playbook-alert-dashboard";
import { cn } from "@/lib/utils";

const numberFormatter = new Intl.NumberFormat("pt-BR");

function formatDelta(comparison: PlaybookAlertComparison) {
  if (comparison.deltaPercent === null) {
    return comparison.current > 0 ? "sem base anterior" : "sem variação";
  }
  const sign = comparison.delta > 0 ? "+" : "";
  return `${sign}${comparison.deltaPercent}% vs período anterior`;
}

function DeltaIcon({ delta }: { delta: number }) {
  if (delta > 0) return <ArrowUpRight className="size-3.5" />;
  if (delta < 0) return <ArrowDownRight className="size-3.5" />;
  return <Minus className="size-3.5" />;
}

function MetricCard({
  label,
  value,
  hint,
  comparison,
  invertDelta = false,
}: {
  label: string;
  value: string;
  hint: string;
  comparison?: PlaybookAlertComparison;
  invertDelta?: boolean;
}) {
  const delta = comparison?.delta ?? 0;
  const tone =
    comparison == null
      ? "text-muted-foreground"
      : delta === 0
        ? "text-muted-foreground"
        : (delta > 0) === invertDelta
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-amber-700 dark:text-amber-400";

  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 truncate text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      <p className={cn("mt-2 inline-flex items-center gap-1 text-xs", tone)}>
        {comparison ? <DeltaIcon delta={delta} /> : null}
        {comparison ? formatDelta(comparison) : hint}
      </p>
    </div>
  );
}

export function AlertsMetricCards({
  created,
  completed,
  pendingNow,
  treatmentRate,
  mostCommon,
}: {
  created: PlaybookAlertComparison;
  completed: PlaybookAlertComparison;
  pendingNow: number;
  treatmentRate: number;
  mostCommon: { ruleId: string; count: number } | null;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <MetricCard
        label="Novos no período"
        value={numberFormatter.format(created.current)}
        hint="Alertas criados"
        comparison={created}
      />
      <MetricCard
        label="Finalizados no período"
        value={numberFormatter.format(completed.current)}
        hint="Concluídos, dispensados ou resolvidos"
        comparison={completed}
        invertDelta
      />
      <MetricCard
        label="Pendentes atuais"
        value={numberFormatter.format(pendingNow)}
        hint="Abertos e em andamento agora"
      />
      <MetricCard
        label="Taxa de tratamento"
        value={`${numberFormatter.format(treatmentRate)}%`}
        hint="Da coorte criada no período"
      />
      <MetricCard
        label="Tipo mais comum"
        value={
          mostCommon
            ? playbookAlertRuleTitle(mostCommon.ruleId)
            : "—"
        }
        hint={
          mostCommon
            ? `${numberFormatter.format(mostCommon.count)} novos`
            : "Nenhum alerta no período"
        }
      />
    </div>
  );
}
