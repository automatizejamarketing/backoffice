export type PlaybookSeverity = "info" | "warning" | "critical";

export type CampaignMetricsRow = {
  id: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  updatedTime: string | null;
  spend: number;
  purchaseRoas: number | null;
  purchases: number;
  purchaseValue: number;
  impressions: number;
  cpa: number | null;
};

export type PlaybookInsightCandidate = {
  ruleId: string;
  severity: PlaybookSeverity;
  confidence: "low" | "medium" | "high";
  entityLevel: "campaign" | "account";
  entityId: string;
  entityName: string;
  actionType: string;
  title: string;
  evidence: string;
  recommendation: string;
  metrics: Record<string, unknown>;
};

export type PlaybookEvaluationResult = {
  accountId: string | null;
  campaigns: CampaignMetricsRow[];
  candidates: PlaybookInsightCandidate[];
};
