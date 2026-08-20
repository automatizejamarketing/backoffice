import type { AnalyticalTag, HudDelivery, SampleCaveat } from "./analysis";

export const PERFORMANCE_REPORT_SCHEMA_VERSION = 1 as const;

export type CampaignReportFact = {
  id: string;
  name: string;
  startDate: string | null;
  accountId: string;
  accountLabel: string;
  tag: AnalyticalTag;
  veiculacao: string;
  delivery: HudDelivery;
  objective: string | null;
  roas: number | null;
  valorDeCompra: number;
  compras: number;
  cpa: number | null;
  gasto: number;
  sampleCaveat: SampleCaveat;
  sampleCaveatLabel: string;
  actionHint: string;
  workspaceUrl: string;
};

export type CampaignTableRow = {
  Conta?: string;
  Nome: string;
  Inicio: string | null;
  Status: AnalyticalTag;
  ROAS: number | null;
  ValorDeCompra: number;
  Compras: number;
  CPA: number | null;
  Gasto: number;
};

export type AccountTotals = {
  scope: string;
  consolidated: boolean;
  consolidationUnavailableReason:
    | "multiple_account_currencies"
    | "partial_account_failure"
    | null;
  coverage: {
    requestedAccounts: number;
    successfulAccounts: number;
    complete: boolean;
  };
  currency: string | null;
  period: {
    datePreset: string;
    since: string | null;
    until: string | null;
    windowDays: number;
    dateStart: string | null;
    dateStop: string | null;
  };
  gasto: number | null;
  compras: number | null;
  valorDeCompra: number | null;
  cpa: number | null;
  roasMeta: number | null;
  roasAjustado: number | null;
  impressoes: number | null;
  cliques: number | null;
  planCost: {
    source: string;
    paidAmount: number;
    currency: string;
    paidAt: string | null;
    billingCycleDays: number;
    allocatedToWindow: number | null;
    allocationRule: string;
    formula: string;
  } | null;
  unavailableReason: string | null;
  unavailableReasonLabel: string | null;
  metricOrder: string[];
};

export type DiagnosticFacts = {
  evidenceRule: string;
  citableCampaignIds: string[];
  bestByRoas: CampaignReportFact[];
  needsAttention: CampaignReportFact[];
  activeWithoutPurchases: CampaignReportFact[];
  concentration: {
    scope: string;
    leadingCampaign: CampaignReportFact | null;
    leadingCampaignShare: number | null;
    displayedCampaignPurchaseValue: number;
  };
};

export type ReportAccountSummary = {
  accountId: string;
  name: string | null;
  label: string;
  currency: string | null;
  error?: string;
  accountMetrics: {
    spend: number;
    purchases: number;
    purchaseValue: number;
    cpa: number | null;
    roas: number | null;
    impressions: number;
    clicks: number;
    dateStart: string | null;
    dateStop: string | null;
  } | null;
  campaignCount: number;
  campaignsTruncated: boolean;
  creativeCount: number;
  creativesTruncated: boolean;
};

export type ClientPerformanceReportV1 = {
  schemaVersion: typeof PERFORMANCE_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  client: {
    userId: string;
    email: string;
    name: string | null;
    plano: string | null;
    planType: string | null;
    renovacao: string | null;
    situacaoMeta: string;
    contasDeAnuncio: Array<{
      accountId: string;
      name: string | null;
      label: string;
      currency: string | null;
    }>;
  };
  accountTotals: AccountTotals;
  campaignCount: number;
  campaignsComplete: boolean;
  tableCoverage: {
    rowCount: number;
    tableGasto: number;
    tableCompras: number;
    tableValorDeCompra: number;
    accountGasto: number | null;
    accountCompras: number | null;
    accountValorDeCompra: number | null;
    note: string;
  };
  campaigns: CampaignReportFact[];
  campaignTable: {
    columns: string[];
    rowCount: number;
    rows: CampaignTableRow[];
  };
  diagnosticFacts: DiagnosticFacts;
  creatives?: Array<Record<string, unknown>>;
  accounts: ReportAccountSummary[];
  formatting: {
    campaignTableColumns: string[];
    campaignMetricsOrder: string[];
    creativeMetricsOrder: string[];
  };
};
