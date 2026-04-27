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
  formatPercentage,
  formatRoas,
} from "../utils/formatters";
import {
  CAMPAIGN_METRIC_DEFINITIONS,
  getMetricRawValue,
  type CampaignMetricId,
} from "../utils/campaign-metrics";

type InsightsChartProps = {
  data: InsightsMetrics[];
  isLoading?: boolean;
  metric?: CampaignMetricId;
};

const metricColors: Record<string, string> = {
  spend: "#10b981",
  impressions: "#3b82f6",
  clicks: "#8b5cf6",
  cpc: "#06b6d4",
  ctr: "#ec4899",
  cpm: "#f59e0b",
  purchaseRoas: "#10b981",
  purchaseCost: "#06b6d4",
  purchaseValue: "#f59e0b",
  purchaseCount: "#8b5cf6",
  linkClicks: "#8b5cf6",
  landingPageViews: "#3b82f6",
  leadCost: "#06b6d4",
  leadCount: "#f97316",
};

function getChartConfig(): ChartConfig {
  return Object.fromEntries(
    Object.values(CAMPAIGN_METRIC_DEFINITIONS).map((metric) => [
      metric.id,
      {
        label: getMetricLabel(metric.labelKey),
        color: metricColors[metric.id],
      },
    ]),
  );
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

  const metricIds = Object.keys(CAMPAIGN_METRIC_DEFINITIONS) as CampaignMetricId[];

  const chartData = data.map((item) => {
    const metricValues = Object.fromEntries(
      metricIds.map((metricId) => [
        metricId,
        Number.parseFloat(getMetricRawValue(item, metricId) ?? "0"),
      ]),
    );

    return {
      date: formatChartDate(item.dateStart),
      rawDate: item.dateStart,
      ...metricValues,
    };
  });

  const formatValue = (value: number) => {
    const metricDefinition = CAMPAIGN_METRIC_DEFINITIONS[metric];

    switch (metricDefinition.format) {
      case "currency":
        return formatCurrency(value);
      case "percentage":
        return formatPercentage(value);
      case "roas":
        return formatRoas(value);
      case "number":
      default:
        return formatNumber(value);
    }
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
              const metricDefinition = CAMPAIGN_METRIC_DEFINITIONS[metric];

              if (metricDefinition.format === "currency") {
                return `R$${
                  value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value
                }`;
              }

              if (metricDefinition.format === "roas") {
                return `${value.toFixed(1)}x`;
              }

              if (metricDefinition.format === "percentage") {
                return `${value.toFixed(0)}%`;
              }

              return value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value;
            }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name) => {
                  const formattedValue = formatValue(value as number);
                  const metricLabel = chartConfig[name as string]?.label;
                  return (
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">
                        {typeof metricLabel === "string" ? metricLabel : String(name)}
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

function getMetricLabel(labelKey: string): string {
  const labels: Record<string, string> = {
    spend: "Gasto",
    impressions: "Impressões",
    clicks: "Cliques",
    reach: "Alcance",
    cpc: "CPC",
    ctr: "CTR",
    cpm: "CPM",
    roas: "ROAS",
    cpa: "CPA",
    purchaseValue: "Valor de compra",
    numberOfPurchases: "Compras",
    linkClicks: "Cliques no link",
    landingPageViews: "Views da página",
    cpl: "CPL",
    numberOfLeads: "Leads",
  };

  return labels[labelKey] ?? labelKey;
}
