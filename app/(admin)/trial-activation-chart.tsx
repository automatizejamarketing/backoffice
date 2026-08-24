"use client";

import { useSyncExternalStore } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  TRIAL_DAILY_GOAL,
  formatActivationDelay,
  type DailyTrialActivation,
} from "@/lib/backoffice/trial-activation";
import { formatCalendarDateLabel } from "@/lib/backoffice/datetime-format";

const chartConfig = {
  sameDay: {
    label: "Cadastro do dia",
    color: "var(--chart-3)",
  },
  existingAccount: {
    label: "Conta antiga",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

const subscribeToClient = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function formatShortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

function TooltipRow({
  label,
  value,
  swatch,
}: {
  label: string;
  value: string;
  swatch?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {swatch ? (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: swatch }}
          />
        ) : null}
        {label}
      </span>
      <span className="font-mono font-medium tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

function TrialActivationTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: DailyTrialActivation }>;
}) {
  const day = payload?.[0]?.payload;
  if (!active || !day) return null;

  return (
    <div className="grid min-w-[13rem] gap-1.5 rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">{formatCalendarDateLabel(day.date)}</p>
      <TooltipRow label="Trials ativados" value={String(day.activations)} />
      <TooltipRow
        label="Cadastro do dia"
        value={String(day.sameDay)}
        swatch="var(--color-sameDay)"
      />
      <TooltipRow
        label="Conta antiga"
        value={String(day.existingAccount)}
        swatch="var(--color-existingAccount)"
      />
      <div className="my-0.5 border-t border-border/50" />
      <TooltipRow
        label="Tempo médio até ativar"
        value={formatActivationDelay(day.avgDelaySeconds)}
      />
      <TooltipRow
        label="Mediana"
        value={formatActivationDelay(day.medianDelaySeconds)}
      />
    </div>
  );
}

export function TrialActivationChart({
  data,
}: {
  data: DailyTrialActivation[];
}) {
  const mounted = useSyncExternalStore(
    subscribeToClient,
    getClientSnapshot,
    getServerSnapshot,
  );
  const chartData = data.map((item) => ({
    ...item,
    dateLabel: formatShortDate(item.date),
  }));
  // Keep the goal band fully visible even on quiet weeks.
  const yMax = Math.max(
    TRIAL_DAILY_GOAL.max + 2,
    ...data.map((item) => item.activations),
  );

  if (!mounted) {
    return <div className="h-[280px] w-full sm:h-[340px]" aria-hidden />;
  }

  return (
    <ChartContainer
      config={chartConfig}
      className="h-[280px] w-full sm:h-[340px]"
    >
      <BarChart
        accessibilityLayer
        data={chartData}
        margin={{ top: 12, right: 10, bottom: 4, left: -18 }}
        barCategoryGap="22%"
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="dateLabel"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          minTickGap={28}
        />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={32}
          domain={[0, yMax]}
        />
        {/* The goal band is the reading key of this chart: a bar that ends
            inside it is a day on target. */}
        <ReferenceArea
          y1={TRIAL_DAILY_GOAL.min}
          y2={TRIAL_DAILY_GOAL.max}
          fill="var(--chart-2)"
          fillOpacity={0.08}
          stroke="var(--chart-2)"
          strokeOpacity={0.4}
          strokeDasharray="4 4"
          label={{
            value: `Meta ${TRIAL_DAILY_GOAL.min}–${TRIAL_DAILY_GOAL.max}`,
            position: "insideTopRight",
            fontSize: 11,
            fill: "var(--muted-foreground)",
            dy: 4,
            dx: -4,
          }}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
          content={<TrialActivationTooltip />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="sameDay"
          stackId="trials"
          fill="var(--color-sameDay)"
          maxBarSize={28}
        />
        <Bar
          dataKey="existingAccount"
          stackId="trials"
          fill="var(--color-existingAccount)"
          maxBarSize={28}
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ChartContainer>
  );
}
