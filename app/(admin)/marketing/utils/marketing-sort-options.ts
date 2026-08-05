import type { SortOrder } from "@/lib/meta-business/campaign-sort";
import type { CampaignMetricId } from "./campaign-metrics";

export type MarketingSortPreset = {
  id: string;
  label: string;
  metric: CampaignMetricId | null;
  order: SortOrder;
};

/** Atalhos de ordenação — métrica + direção em uma única opção. */
export const MARKETING_QUICK_SORT_PRESETS: MarketingSortPreset[] = [
  {
    id: "status",
    label: "Status (ativos primeiro)",
    metric: null,
    order: "desc",
  },
  {
    id: "roas-desc",
    label: "ROAS do maior pro menor",
    metric: "purchaseRoas",
    order: "desc",
  },
  {
    id: "roas-asc",
    label: "ROAS do menor pro maior",
    metric: "purchaseRoas",
    order: "asc",
  },
  {
    id: "purchase-value-desc",
    label: "Valor de compra do maior pro menor",
    metric: "purchaseValue",
    order: "desc",
  },
  {
    id: "purchase-value-asc",
    label: "Valor de compra do menor pro maior",
    metric: "purchaseValue",
    order: "asc",
  },
  {
    id: "purchase-count-desc",
    label: "Compras do maior pro menor",
    metric: "purchaseCount",
    order: "desc",
  },
  {
    id: "purchase-count-asc",
    label: "Compras do menor pro maior",
    metric: "purchaseCount",
    order: "asc",
  },
  {
    id: "spend-desc",
    label: "Gasto do maior pro menor",
    metric: "spend",
    order: "desc",
  },
  {
    id: "spend-asc",
    label: "Gasto do menor pro maior",
    metric: "spend",
    order: "asc",
  },
];

export function findActiveSortPreset(
  sortMetric: CampaignMetricId | null,
  sortOrder: SortOrder,
): MarketingSortPreset | null {
  return (
    MARKETING_QUICK_SORT_PRESETS.find(
      (preset) => preset.metric === sortMetric && preset.order === sortOrder,
    ) ?? null
  );
}
