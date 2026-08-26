export type PlaybookSeverity = "info" | "warning" | "critical";

export type CampaignMetricsRow = {
  id: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  updatedTime: string | null;
  createdTime: string | null;
  spend: number;
  /** Spend in the trailing 10 calendar days; used only for eligibility. */
  spendLast10Days: number;
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
  entityLevel: "campaign" | "account" | "ad";
  entityId: string;
  entityName: string;
  actionType: string;
  title: string;
  evidence: string;
  recommendation: string;
  metrics: Record<string, unknown>;
};

export type CreativeDiagnosisPlaybookRow = {
  id: string;
  adId: string;
  campaignId: string | null;
  adName: string | null;
  likelyContributor: boolean | null;
  confidence: "high" | "medium" | "low" | null;
  diagnosis: unknown;
};

export type PlaybookEvaluationResult = {
  accountId: string | null;
  campaigns: CampaignMetricsRow[];
  candidates: PlaybookInsightCandidate[];
};
