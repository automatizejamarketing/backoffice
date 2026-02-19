"use client";
import {
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import type { InsightsMetrics } from "@/lib/meta-business/types";
import {
  formatChartDate,
  formatCurrency,
  formatNumber,
} from "../utils/formatters";

type InsightsChartProps = {
  data: InsightsMetrics[];
  isLoading?: boolean;
  metric?: "spend" | "impressions" | "clicks" | "cpc" | "cpm";
};

const metricColors: Record<string, string> = {
  spend: "#10b981",
  impressions: "#3b82f6",
  clicks: "#8b5cf6",
  cpc: "#06b6d4",
  cpm: "#ec4899",
};

const METRIC_LABELS: Record<string, string> = {
  spend: "Gasto",
  impressions: "Impressões",
  clicks: "Cliques",
  cpc: "CPC",
  cpm: "CPM",
};

function getChartConfig(): ChartConfig {
  return {
    spend: {
      label: "Gasto",
      color: metricColors.spend,
    },
    impressions: {
      label: "Impressões",
      color: metricColors.impressions,
    },
    clicks: {
      label: "Cliques",
      color: metricColors.clicks,
    },
    cpc: {
      label: "CPC",
      color: metricColors.cpc,
    },
    cpm: {
      label: "CPM",
      color: metricColors.cpm,
    },
  };
}

function getMetricColor(metric: string): string {
  return metricColors[metric] || metricColors.spend;
}

export function InsightsChart({
  data,
  isLoading = false,
  metric = "spend",
}: InsightsChartProps) {
  const chartConfig = getChartConfig();
  const metricColor = getMetricColor(metric);

  if (isLoading) {
    return (
      <div className="w-full h-[250px] sm:h-[300px] flex items-center justify-center">
        <Skeleton className="w-full h-full rounded-lg" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="w-full h-[250px] sm:h-[300px] flex items-center justify-center border rounded-lg bg-muted/30">
        <p className="text-muted-foreground text-sm">Sem dados</p>
      </div>
    );
  }

  const chartData = data.map((item) => ({
    date: formatChartDate(item.dateStart),
    rawDate: item.dateStart,
    spend: parseFloat(item.spend ?? "0"),
    impressions: parseInt(item.impressions ?? "0"),
    clicks: parseInt(item.clicks ?? "0"),
    cpc: parseFloat(item.cpc ?? "0"),
    cpm: parseFloat(item.cpm ?? "0"),
  }));

  const formatValue = (value: number) => {
    if (metric === "spend" || metric === "cpc" || metric === "cpm") {
      return formatCurrency(value);
    }
    return formatNumber(value);
  };

  return (
    <ChartContainer
      config={chartConfig}
      className="w-full h-[250px] sm:h-[300px]"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tickMargin={8}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tickMargin={8}
            tickFormatter={(value) => {
              if (metric === "spend" || metric === "cpc" || metric === "cpm") {
                return `R$${
                  value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value
                }`;
              }
              return value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value;
            }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name) => {
                  const formattedValue = formatValue(value as number);
                  return (
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">
                        {METRIC_LABELS[name as string] ?? name}
                      </span>
                      <span className="font-medium">{formattedValue}</span>
                    </div>
                  );
                }}
              />
            }
          />
          <Line
            type="monotone"
            dataKey={metric}
            stroke={metricColor}
            strokeWidth={2}
            dot={false}
            activeDot={{
              r: 5,
              fill: metricColor,
              stroke: "hsl(var(--card))",
              strokeWidth: 2,
              className: "drop-shadow-sm",
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
