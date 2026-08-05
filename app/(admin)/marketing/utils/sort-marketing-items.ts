import type { SortOrder } from "@/lib/meta-business/campaign-sort";
import { EffectiveStatus } from "@/lib/meta-business/types";
import {
  getMetricRawValue,
  type CampaignMetricId,
} from "./campaign-metrics";

type SortableEntity = {
  status?: string | null;
  effectiveStatus?: string | null;
  insights?: Parameters<typeof getMetricRawValue>[0];
};

function statusPriority(entity: SortableEntity): number {
  const status = entity.effectiveStatus ?? entity.status;
  if (status === EffectiveStatus.ACTIVE) return 0;
  if (status === EffectiveStatus.PAUSED) return 1;
  if (status === EffectiveStatus.CAMPAIGN_PAUSED) return 2;
  return 3;
}

function metricNumericValue(
  insights: SortableEntity["insights"],
  metricId: CampaignMetricId,
): number {
  const raw = getMetricRawValue(insights, metricId);
  if (raw == null || raw === "") return Number.NEGATIVE_INFINITY;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function sortMarketingItems<T extends SortableEntity>(
  items: T[],
  sortMetric: CampaignMetricId | null,
  sortOrder: SortOrder,
): T[] {
  if (!sortMetric) {
    return [...items].sort((a, b) => statusPriority(a) - statusPriority(b));
  }

  const direction = sortOrder === "asc" ? 1 : -1;

  return [...items].sort((a, b) => {
    const aValue = metricNumericValue(a.insights, sortMetric);
    const bValue = metricNumericValue(b.insights, sortMetric);

    if (aValue !== bValue) {
      return aValue > bValue ? direction : -direction;
    }

    return statusPriority(a) - statusPriority(b);
  });
}
