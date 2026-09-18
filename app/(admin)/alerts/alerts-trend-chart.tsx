"use client";

import { useSyncExternalStore } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCalendarDateLabel } from "@/lib/backoffice/datetime-format";

const chartConfig = {
  created: {
    label: "Novos",
    color: "var(--chart-1)",
  },
  completed: {
    label: "Finalizados",
    color: "var(--chart-4)",
  },
} satisfies ChartConfig;

const subscribeToClient = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function formatShortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

export function AlertsTrendChart({
  data,
}: {
  data: Array<{ date: string; created: number; completed: number }>;
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

  if (!mounted) {
    return <div className="h-[260px] w-full sm:h-[300px]" aria-hidden />;
  }

  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-lg border bg-muted/30 sm:h-[300px]">
        <p className="text-sm text-muted-foreground">Sem dados no período</p>
      </div>
    );
  }

  return (
    <ChartContainer
      config={chartConfig}
      className="h-[260px] w-full sm:h-[300px]"
    >
      <LineChart
        accessibilityLayer
        data={chartData}
        margin={{ top: 12, right: 10, bottom: 4, left: -18 }}
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
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const first = payload[0] as
                  | { payload?: { date?: string } }
                  | undefined;
                return first?.payload?.date
                  ? formatCalendarDateLabel(first.payload.date)
                  : null;
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          type="linear"
          dataKey="created"
          stroke="var(--color-created)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="linear"
          dataKey="completed"
          stroke="var(--color-completed)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ChartContainer>
  );
}
