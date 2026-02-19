"use client";

import { DollarSign, Eye, MousePointerClick, TrendingUp, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { InsightsMetrics } from "@/lib/meta-business/types";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
} from "../utils/formatters";

type InsightsCardsProps = {
  insights?: InsightsMetrics;
  isLoading?: boolean;
};

export function InsightsCards({ insights, isLoading = false }: InsightsCardsProps) {
  if (isLoading) {
    return <InsightsCardsSkeleton />;
  }

  const metrics = [
    {
      label: "Gasto Total",
      value: formatCurrency(insights?.spend),
      icon: DollarSign,
      color: "text-emerald-500",
    },
    {
      label: "Impressões",
      value: formatNumber(insights?.impressions),
      icon: Eye,
      color: "text-blue-500",
    },
    {
      label: "Cliques",
      value: formatNumber(insights?.clicks),
      icon: MousePointerClick,
      color: "text-violet-500",
    },
    {
      label: "Alcance",
      value: formatNumber(insights?.reach),
      icon: Users,
      color: "text-orange-500",
    },
    {
      label: "CPC",
      value: formatCurrency(insights?.cpc),
      icon: TrendingUp,
      color: "text-cyan-500",
    },
    {
      label: "CTR",
      value: formatPercentage(insights?.ctr),
      icon: MousePointerClick,
      color: "text-pink-500",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {metrics.map((metric) => (
        <Card key={metric.label} className="bg-card">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <metric.icon className={`size-4 ${metric.color}`} />
              <span className="text-xs text-muted-foreground truncate">
                {metric.label}
              </span>
            </div>
            <p className="text-lg sm:text-xl font-semibold tabular-nums">
              {metric.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function InsightsCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="bg-card">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="h-6 w-16 mt-1" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
