"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CAMPAIGN_METRIC_DEFINITIONS,
  type CampaignMetricId,
} from "../utils/campaign-metrics";

const STORAGE_KEY = "automatize:backoffice:marketing:metric-columns:v1";

function isCampaignMetricId(value: unknown): value is CampaignMetricId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(CAMPAIGN_METRIC_DEFINITIONS, value)
  );
}

function sanitizeMetricIds(value: unknown): CampaignMetricId[] | null {
  if (!Array.isArray(value)) return null;

  const metricIds = value.filter(isCampaignMetricId);
  const uniqueMetricIds = Array.from(new Set(metricIds));
  return uniqueMetricIds.length > 0 ? uniqueMetricIds : null;
}

export function useMetricColumnPreferences() {
  const [selectedMetricIds, setSelectedMetricIdsState] = useState<
    CampaignMetricId[] | null
  >(null);

  useEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(STORAGE_KEY);
      if (!storedValue) return;

      const parsedValue = JSON.parse(storedValue);
      const sanitizedMetricIds = sanitizeMetricIds(parsedValue);
      queueMicrotask(() => setSelectedMetricIdsState(sanitizedMetricIds));

      if (sanitizedMetricIds) {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(sanitizedMetricIds),
        );
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const setSelectedMetricIds = useCallback(
    (metricIds: CampaignMetricId[] | null) => {
      const sanitizedMetricIds = metricIds ? sanitizeMetricIds(metricIds) : null;
      setSelectedMetricIdsState(sanitizedMetricIds);

      if (sanitizedMetricIds) {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(sanitizedMetricIds),
        );
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    },
    [],
  );

  return {
    selectedMetricIds,
    setSelectedMetricIds,
  };
}
