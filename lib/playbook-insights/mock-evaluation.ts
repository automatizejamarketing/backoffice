import { buildFullDemoCampaignMetrics } from "@/lib/meta-fake/full-demo-campaigns";
import {
  evaluatePlaybookInsights,
  type PlaybookEvaluationConfig,
} from "./evaluate";
import type { PlaybookEvaluationResult } from "./types";

/**
 * Synthetic campaigns that exercise every playbook rule for UI/staging demos.
 * No Meta calls — evidence/recommendation text comes from the real evaluator.
 */
export function buildMockPlaybookEvaluation(
  now = new Date(),
  config?: PlaybookEvaluationConfig,
): PlaybookEvaluationResult {
  return evaluatePlaybookInsights({
    accountId: "act_mock_playbook_staging",
    campaigns: buildFullDemoCampaignMetrics(now),
    now,
    config,
  });
}
