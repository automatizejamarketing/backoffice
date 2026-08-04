"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { DailyConversionCohort } from "@/lib/backoffice/conversion-dashboard";

const chartConfig = {
  newUsers: {
    label: "Criaram conta",
    color: "var(--chart-1)",
  },
  onboardingCompleted: {
    label: "Terminaram onboarding",
    color: "var(--chart-3)",
  },
  metaConnected: {
    label: "Conectaram Meta",
    color: "var(--chart-2)",
  },
  paid: {
    label: "Pagaram",
    color: "var(--chart-4)",
  },
} satisfies ChartConfig;

function formatShortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

function formatLongDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function ConversionTrendChart({
  data,
}: {
  data: DailyConversionCohort[];
}) {
  const chartData = data.map((item) => ({
    ...item,
    dateLabel: formatShortDate(item.date),
  }));

  return (
    <ChartContainer
      config={chartConfig}
      className="h-[280px] w-full sm:h-[340px]"
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
                  ? formatLongDate(first.payload.date)
                  : null;
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          type="linear"
          dataKey="newUsers"
          stroke="var(--color-newUsers)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="linear"
          dataKey="onboardingCompleted"
          stroke="var(--color-onboardingCompleted)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="linear"
          dataKey="metaConnected"
          stroke="var(--color-metaConnected)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="linear"
          dataKey="paid"
          stroke="var(--color-paid)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ChartContainer>
  );
}
