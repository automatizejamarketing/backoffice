export type PlaybookSeverity = "info" | "warning" | "critical";

export type CampaignMetricsRow = {
  id: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  /** Campaign `stop_time`. Past dates mean Concluída even when Graph stays ACTIVE. */
  stopTime: string | null;
  /** Meta campaign objective (ODAX or legacy). Gates ROAS/CPA rules. */
  objective: string | null;
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
  /** Length of the adjacent windows used for ROAS-decline (0 = not fetched). */
  lookbackDays: number;
  spendLookback: number;
  purchaseRoasLookback: number | null;
  purchasesLookback: number;
  spendPrevious: number;
  purchaseRoasPrevious: number | null;
  purchasesPrevious: number;
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

export const EMPTY_ROAS_LOOKBACK = {
  lookbackDays: 0,
  spendLookback: 0,
  purchaseRoasLookback: null,
  purchasesLookback: 0,
  spendPrevious: 0,
  purchaseRoasPrevious: null,
  purchasesPrevious: 0,
} as const satisfies Pick<
  CampaignMetricsRow,
  | "lookbackDays"
  | "spendLookback"
  | "purchaseRoasLookback"
  | "purchasesLookback"
  | "spendPrevious"
  | "purchaseRoasPrevious"
  | "purchasesPrevious"
>;
