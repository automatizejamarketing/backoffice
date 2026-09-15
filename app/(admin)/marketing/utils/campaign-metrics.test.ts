import assert from "node:assert/strict";
import test from "node:test";

import { CampaignObjective } from "@/lib/meta-business/types";
import {
  getCampaignMetricBucket,
  getCampaignMetricsForObjective,
  getMetricRawValue,
  resolveCampaignTableMetrics,
} from "./campaign-metrics";
import { MARKETING_QUICK_SORT_PRESETS } from "./marketing-sort-options";
import { sortMarketingItems } from "./sort-marketing-items";

test("messaging classification overrides an ODAX sales objective", () => {
  assert.equal(
    getCampaignMetricBucket(CampaignObjective.OUTCOME_SALES, true),
    "messaging",
  );
});

test("conversation campaigns default to the primary messaging table metrics", () => {
  assert.deepEqual(
    getCampaignMetricsForObjective(
      CampaignObjective.OUTCOME_ENGAGEMENT,
      "desktopList",
      true,
    ).map((metric) => metric.id),
    [
      "messagingConversationCount",
      "messagingConversationCost",
      "messagingNewContactCount",
      "messagingNewContactCost",
      "spend",
    ],
  );
});

test("all four documented messaging actions are available in campaign details", () => {
  const metricIds = getCampaignMetricsForObjective(
    CampaignObjective.OUTCOME_LEADS,
    "detailCards",
    true,
  ).map((metric) => metric.id);

  assert.ok(metricIds.includes("messagingConversationCount"));
  assert.ok(metricIds.includes("messagingNewContactCount"));
  assert.ok(metricIds.includes("messagingBlockedCount"));
  assert.ok(metricIds.includes("messagingSubscriptionCount"));
});

test("a custom table selection still wins over messaging defaults", () => {
  assert.deepEqual(
    resolveCampaignTableMetrics(
      CampaignObjective.OUTCOME_SALES,
      "desktopList",
      ["reach"],
      true,
    ).map((metric) => metric.id),
    ["reach"],
  );
});

test("messaging subscriptions can be formatted and sorted from insights", () => {
  assert.equal(
    getMetricRawValue(
      { messagingSubscriptionCount: "7" },
      "messagingSubscriptionCount",
    ),
    "7",
  );
});

test("backoffice quick sort ranks campaigns by conversations and conversation cost", () => {
  assert.ok(
    MARKETING_QUICK_SORT_PRESETS.some(
      (preset) =>
        preset.metric === "messagingConversationCount" &&
        preset.order === "desc",
    ),
  );
  assert.ok(
    MARKETING_QUICK_SORT_PRESETS.some(
      (preset) =>
        preset.metric === "messagingConversationCost" && preset.order === "asc",
    ),
  );

  const campaigns = [
    {
      id: "campaign-low",
      insights: {
        messagingConversationCount: "3",
        messagingConversationCost: "20",
      },
    },
    {
      id: "campaign-high",
      insights: {
        messagingConversationCount: "12",
        messagingConversationCost: "8",
      },
    },
  ];

  assert.deepEqual(
    sortMarketingItems(
      campaigns,
      "messagingConversationCount",
      "desc",
    ).map((campaign) => campaign.id),
    ["campaign-high", "campaign-low"],
  );
  assert.deepEqual(
    sortMarketingItems(
      campaigns,
      "messagingConversationCost",
      "asc",
    ).map((campaign) => campaign.id),
    ["campaign-high", "campaign-low"],
  );
});
