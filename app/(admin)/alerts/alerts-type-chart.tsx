"use client";

import { useSyncExternalStore } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const chartConfig = {
  count: {
    label: "Novos alertas",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

const subscribeToClient = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function AlertsTypeChart({
  data,
}: {
  data: Array<{ ruleId: string; title: string; count: number }>;
}) {
  const mounted = useSyncExternalStore(
    subscribeToClient,
    getClientSnapshot,
    getServerSnapshot,
  );

  if (!mounted) {
    return <div className="h-[260px] w-full sm:h-[300px]" aria-hidden />;
  }

  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-lg border bg-muted/30 sm:h-[300px]">
        <p className="text-sm text-muted-foreground">Sem tipos no período</p>
      </div>
    );
  }

  return (
    <ChartContainer
      config={chartConfig}
      className="h-[260px] w-full sm:h-[300px]"
    >
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 12, bottom: 4, left: 8 }}
      >
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" allowDecimals={false} hide />
        <YAxis
          type="category"
          dataKey="title"
          tickLine={false}
          axisLine={false}
          width={132}
          tickMargin={8}
          fontSize={11}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar
          dataKey="count"
          fill="var(--color-count)"
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ChartContainer>
  );
}
