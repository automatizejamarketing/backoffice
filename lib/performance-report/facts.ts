import type { AnalyticalTag, HudDelivery, SampleCaveat } from "./analysis";
import { sortCampaignsNewestFirst } from "./analysis";
import { campaignActionHint } from "./labels";
import { PLAYBOOK_RULE_ROAS_DECLINE } from "@/lib/playbook-insights/constants";
import type {
  CampaignReportFact,
  CampaignTableRow,
  DiagnosticFacts,
  RoasDeclineFact,
} from "./types";
import { buildCampaignWorkspaceUrl } from "./url";

export type ClassifiedCampaign = {
  id: string;
  name: string;
  startDate: string | null;
  stopDate: string | null;
  objective: string | null;
  tag: AnalyticalTag;
  veiculacao: string;
  delivery: HudDelivery;
  toggleAtivo: boolean;
  effectiveStatus: string | null;
  roas: number | null;
  valorDeCompra: number;
  compras: number;
  cpa: number | null;
  gasto: number;
  sampleCaveat: SampleCaveat;
  sampleCaveatLabel: string;
};

export type ConsolidatedCampaign = ClassifiedCampaign & {
  accountId: string;
  accountName: string | null;
};

export type WorkspaceLinkInput = {
  userId: string;
  datePreset?: string;
  since?: string;
  until?: string;
};

export function campaignFact(
  campaign: ConsolidatedCampaign,
  accountLabelById: Record<string, string>,
  workspace: WorkspaceLinkInput,
): CampaignReportFact {
  return {
    id: campaign.id,
    name: campaign.name,
    startDate: campaign.startDate,
    accountId: campaign.accountId,
    accountLabel:
      accountLabelById[campaign.accountId] ??
      campaign.accountName ??
      campaign.accountId,
    tag: campaign.tag,
    veiculacao: campaign.veiculacao,
    delivery: campaign.delivery,
    objective: campaign.objective,
    roas: campaign.roas,
    valorDeCompra: campaign.valorDeCompra,
    compras: campaign.compras,
    cpa: campaign.cpa,
    gasto: campaign.gasto,
    sampleCaveat: campaign.sampleCaveat,
    sampleCaveatLabel: campaign.sampleCaveatLabel,
    actionHint: campaignActionHint(campaign),
    workspaceUrl: buildCampaignWorkspaceUrl({
      userId: workspace.userId,
      accountId: campaign.accountId,
      campaignId: campaign.id,
      datePreset: workspace.datePreset,
      since: workspace.since,
      until: workspace.until,
    }),
  };
}

export function buildCampaignDiagnosticFacts(
  campaigns: ConsolidatedCampaign[],
  accountLabelById: Record<string, string>,
  workspace: WorkspaceLinkInput,
) {
  const fact = (campaign: ConsolidatedCampaign) =>
    campaignFact(campaign, accountLabelById, workspace);
  const withSpend = campaigns.filter((campaign) => campaign.gasto > 0);
  const byRoas = withSpend
    .filter((campaign) => campaign.roas !== null)
    .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0));
  const zeroPurchase = withSpend
    .filter((campaign) => campaign.compras === 0)
    .sort((a, b) => b.gasto - a.gasto);
  const lowRoas = [...byRoas].reverse();
  const attentionById = new Map<string, ConsolidatedCampaign>();
  for (const campaign of [...zeroPurchase, ...lowRoas]) {
    if (!attentionById.has(campaign.id)) {
      attentionById.set(campaign.id, campaign);
    }
  }

  const byPurchaseValue = campaigns
    .filter((campaign) => campaign.valorDeCompra > 0)
    .sort((a, b) => b.valorDeCompra - a.valorDeCompra);
  const displayedPurchaseValue = byPurchaseValue.reduce(
    (total, campaign) => total + campaign.valorDeCompra,
    0,
  );
  const leader = byPurchaseValue.at(0);
  const leaderShare =
    leader && displayedPurchaseValue > 0
      ? leader.valorDeCompra / displayedPurchaseValue
      : null;

  return {
    evidenceRule:
      "Cite somente campanhas em `citableCampaignIds`. Copie nome, startDate e métricas exatamente. Nunca mencione campanha ausente da tabela. `roasInDecline` é tendência recente (N dias vs. N anteriores) — não trate ROAS absoluto alto como saudável quando houver queda.",
    citableCampaignIds: campaigns.map((campaign) => campaign.id),
    bestByRoas: byRoas.slice(0, 3).map(fact),
    needsAttention: [...attentionById.values()].slice(0, 3).map(fact),
    roasInDecline: [],
    activeWithoutPurchases: campaigns
      .filter(
        (campaign) => campaign.delivery === "active" && campaign.compras === 0,
      )
      .map(fact),
    concentration: {
      scope:
        "Participação no valor de compra entre as campanhas exibidas na tabela.",
      leadingCampaign: leader ? fact(leader) : null,
      leadingCampaignShare: leaderShare,
      displayedCampaignPurchaseValue: displayedPurchaseValue,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function attachRoasDeclineFacts(
  facts: DiagnosticFacts,
  insights: Array<{
    ruleId: string;
    entityId: string;
    entityName: string | null;
    severity: string;
    evidence: string;
    metrics: unknown;
  }>,
  campaigns: ConsolidatedCampaign[],
  workspace: WorkspaceLinkInput,
): DiagnosticFacts {
  const byId = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const roasInDecline: RoasDeclineFact[] = [];
  for (const insight of insights) {
    if (insight.ruleId !== PLAYBOOK_RULE_ROAS_DECLINE) continue;
    const campaign = byId.get(insight.entityId);
    if (!campaign) continue;
    const metrics = asRecord(insight.metrics);
    const dropPercent =
      asNumber(metrics.dropPercent) ??
      (asNumber(metrics.dropRatio) != null
        ? Math.round((asNumber(metrics.dropRatio) as number) * 100)
        : null);
    roasInDecline.push({
      id: insight.entityId,
      name: insight.entityName ?? campaign.name,
      accountId: campaign.accountId,
      dropPercent,
      severity: "warning",
      previousRoas: asNumber(metrics.purchaseRoasPrevious),
      currentRoas: asNumber(metrics.purchaseRoasLookback),
      lookbackDays: asNumber(metrics.lookbackDays) ?? 7,
      evidence: insight.evidence,
      workspaceUrl: buildCampaignWorkspaceUrl({
        userId: workspace.userId,
        accountId: campaign.accountId,
        campaignId: campaign.id,
        datePreset: workspace.datePreset,
        since: workspace.since,
        until: workspace.until,
      }),
    });
  }
  return { ...facts, roasInDecline };
}

export function buildCampaignTable(
  campaigns: ConsolidatedCampaign[],
  multipleAccounts: boolean,
  accountLabelById: Record<string, string>,
): {
  columns: string[];
  rowCount: number;
  rows: CampaignTableRow[];
} {
  const columns = [
    ...(multipleAccounts ? ["Conta"] : []),
    "Nome",
    "Início",
    "Status",
    "ROAS",
    "Valor de compra",
    "Compras",
    "CPA",
    "Gasto",
  ];
  const rows = campaigns.map((campaign) => ({
    ...(multipleAccounts
      ? {
          Conta:
            accountLabelById[campaign.accountId] ??
            campaign.accountName ??
            campaign.accountId,
        }
      : {}),
    Nome: campaign.name,
    Inicio: campaign.startDate,
    Status: campaign.tag,
    ROAS: campaign.roas,
    ValorDeCompra: campaign.valorDeCompra,
    Compras: campaign.compras,
    CPA: campaign.cpa,
    Gasto: campaign.gasto,
  }));
  return { columns, rowCount: rows.length, rows };
}

export function sumCampaignTable(campaigns: ConsolidatedCampaign[]) {
  return campaigns.reduce(
    (acc, campaign) => ({
      gasto: acc.gasto + campaign.gasto,
      compras: acc.compras + campaign.compras,
      valorDeCompra: acc.valorDeCompra + campaign.valorDeCompra,
    }),
    { gasto: 0, compras: 0, valorDeCompra: 0 },
  );
}

export function consolidateCampaigns(
  accounts: Array<{
    accountId: string;
    name: string | null;
    campaigns: ClassifiedCampaign[];
  }>,
): ConsolidatedCampaign[] {
  const rows = accounts.flatMap((account) =>
    account.campaigns.map((campaign) => ({
      ...campaign,
      accountId: account.accountId,
      accountName: account.name,
      startTime: campaign.startDate,
    })),
  );
  return sortCampaignsNewestFirst(rows).map(
    ({ startTime: _startTime, ...row }) => row,
  );
}
