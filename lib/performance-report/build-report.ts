import {
  ACCOUNT_TOTALS_ORDER,
  ADJUSTED_ROAS_REASONS,
  CAMPAIGN_METRICS_ORDER,
  CREATIVE_METRICS_ORDER,
  addMetricTotals,
  allocatePlanCost,
  analyticalTagFromDelivery,
  billingCycleDays,
  computeRoasPair,
  derivedCpa,
  derivedRoas,
  emptyMetricTotals,
  groupCreatives,
  hudDeliveryLabel,
  isHudVisibleCampaign,
  mapHudDelivery,
  paymentAmountReais,
  sampleCaveat,
  sampleCaveatLabel,
  sortCampaignsNewestFirst,
  windowDays,
} from "./analysis";
import {
  getLatestSucceededPayment,
  getReportClientByEmail,
  getReportClientByUserId,
  type ReportClient,
} from "./client";
import { PerformanceReportError } from "./errors";
import {
  parseReportFilters,
  type PerformanceReportFilters,
} from "./filters";
import { loadClientInsightsBundle, type CampaignInsightRow } from "./insights";
import { buildAccountLabels } from "./labels";
import {
  buildCampaignDiagnosticFacts,
  buildCampaignTable,
  campaignFact,
  consolidateCampaigns,
  sumCampaignTable,
  type ClassifiedCampaign,
  type WorkspaceLinkInput,
} from "./facts";
import {
  PERFORMANCE_REPORT_SCHEMA_VERSION,
  type ClientPerformanceReportV1,
} from "./types";

const PLAN_LABELS: Record<string, string> = {
  monthly_starter: "Starter Mensal",
  quarterly_starter: "Starter Trimestral",
  semiannual_starter: "Starter Semestral",
  annual_starter: "Starter Anual",
  monthly_pro: "Pro Mensal",
  quarterly_pro: "Pro Trimestral",
  semiannual_pro: "Pro Semestral",
  annual_pro: "Pro Anual",
  monthly_premium: "Premium Mensal",
  quarterly_premium: "Premium Trimestral",
  semiannual_premium: "Premium Semestral",
  annual_premium: "Premium Anual",
};

function planLabel(planType: string | null): string | null {
  if (!planType) return null;
  return PLAN_LABELS[planType] ?? planType;
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function metaSituation(input: {
  metaConnected: boolean;
  metaConnectionStatus: string | null;
}): string {
  if (!input.metaConnected) return "Meta desconectada";
  const status = input.metaConnectionStatus?.trim();
  if (!status || status === "connected") return "Meta conectada";
  if (status === "needs_reconnect") return "Meta precisa reconectar";
  return `Meta: ${status}`;
}

function consolidationReason(
  coverageComplete: boolean,
  singleCurrency: boolean,
): "multiple_account_currencies" | "partial_account_failure" | null {
  if (!coverageComplete) return "partial_account_failure";
  if (!singleCurrency) return "multiple_account_currencies";
  return null;
}

function totalsScope(accountCount: number, coverageComplete: boolean): string {
  if (!coverageComplete) {
    return "Não foi possível consolidar todas as contas; use os totais individuais e cite as falhas.";
  }
  if (accountCount === 1) {
    return "Estes valores cobrem toda a conta de anúncio no período; não representam uma única campanha.";
  }
  return `Estes valores consolidam todas as ${accountCount} contas de anúncio no período; não representam uma única campanha.`;
}

function adjustedUnavailableLabel(
  canConsolidate: boolean,
  reason: keyof typeof ADJUSTED_ROAS_REASONS | null,
): string | null {
  if (!canConsolidate) {
    return "Totais consolidados indisponíveis; moedas ou cobertura das contas são incompatíveis.";
  }
  if (!reason) return null;
  return ADJUSTED_ROAS_REASONS[reason];
}

type ReportAccount = {
  accountId: string;
  name: string | null;
  currency: string | null;
  error?: string;
  truncated?: { campaigns?: boolean; ads?: boolean };
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
  campaigns: ClassifiedCampaign[];
  creatives:
    | Array<
        ReturnType<typeof groupCreatives>[number] & {
          sampleCaveatLabel: string;
        }
      >
    | undefined;
};

function classifyCampaigns(
  campaigns: CampaignInsightRow[],
  now: number,
): ClassifiedCampaign[] {
  return sortCampaignsNewestFirst(
    campaigns.filter((campaign) => isHudVisibleCampaign(campaign.effectiveStatus)),
  ).map((campaign) => {
    const delivery = mapHudDelivery(
      campaign.effectiveStatus,
      campaign.stopTime,
      now,
    );
    const caveat = sampleCaveat(campaign);
    return {
      id: campaign.id,
      name: campaign.name,
      startDate: isoDate(campaign.startTime || campaign.createdTime),
      stopDate: isoDate(campaign.stopTime),
      objective: campaign.objective,
      tag: analyticalTagFromDelivery(delivery),
      veiculacao: hudDeliveryLabel(delivery),
      delivery,
      toggleAtivo: campaign.status?.toUpperCase() === "ACTIVE",
      effectiveStatus: campaign.effectiveStatus,
      roas: campaign.roas,
      valorDeCompra: campaign.purchaseValue,
      compras: campaign.purchases,
      cpa: campaign.cpa,
      gasto: campaign.spend,
      sampleCaveat: caveat,
      sampleCaveatLabel: sampleCaveatLabel(caveat),
    };
  });
}

async function resolveClient(
  input: PerformanceReportFilters,
): Promise<ReportClient> {
  if (input.userId?.trim()) {
    const client = await getReportClientByUserId(input.userId.trim());
    if (!client) {
      throw new PerformanceReportError(
        404,
        `Usuário não encontrado: ${input.userId}`,
      );
    }
    return client;
  }
  if (input.email?.trim()) {
    const client = await getReportClientByEmail(input.email);
    if (!client) {
      throw new PerformanceReportError(
        404,
        `Usuário não encontrado: ${input.email}`,
      );
    }
    return client;
  }
  throw new PerformanceReportError(400, "Informe email ou userId do cliente.");
}

export async function buildClientPerformanceReport(
  input: PerformanceReportFilters,
): Promise<ClientPerformanceReportV1> {
  let filters;
  try {
    filters = parseReportFilters(input);
  } catch (error) {
    throw new PerformanceReportError(
      400,
      error instanceof Error ? error.message : String(error),
    );
  }

  const client = await resolveClient(input);
  const includeCreatives = filters.includeCreatives;
  let bundle;
  try {
    bundle = await loadClientInsightsBundle({
      client,
      accountId: filters.accountId,
      campaignId: filters.campaignId,
      datePreset: filters.datePreset,
      since: filters.since,
      until: filters.until,
      includeCreatives,
    });
  } catch (error) {
    throw new PerformanceReportError(
      502,
      error instanceof Error ? error.message : String(error),
    );
  }

  const payment = await getLatestSucceededPayment(client.userId);
  const now = Date.now();
  const accountRows: ReportAccount[] = bundle.accounts.map((account) => {
    const campaigns = classifyCampaigns(account.campaigns ?? [], now);
    const creatives = account.ads
      ? groupCreatives(
          account.ads.map((ad) => ({
            id: ad.id,
            name: ad.name,
            campaignId: ad.campaignId,
            campaignName: ad.campaignName,
            creativeId: ad.creativeId,
            creativeName: ad.creativeName || ad.creativeTitle || ad.name,
            spend: ad.spend,
            purchases: ad.purchases,
            purchaseValue: ad.purchaseValue,
            cpa: ad.cpa,
            roas: ad.roas,
          })),
        ).map((creative) => ({
          ...creative,
          sampleCaveatLabel: sampleCaveatLabel(creative.sampleCaveat),
        }))
      : undefined;

    return {
      accountId: account.accountId,
      name: account.name,
      currency: account.currency,
      error: account.error,
      truncated: account.truncated,
      accountMetrics: account.accountMetrics ?? null,
      campaigns,
      creatives,
    };
  });

  const campaigns = consolidateCampaigns(accountRows);
  const accountLabelById = buildAccountLabels(
    accountRows.map((account) => ({
      accountId: account.accountId,
      name: account.name,
    })),
  );
  const workspace: WorkspaceLinkInput = {
    userId: client.userId,
    datePreset: bundle.datePreset,
    since: bundle.since ?? undefined,
    until: bundle.until ?? undefined,
  };
  const creatives = accountRows.flatMap((account) =>
    (account.creatives ?? []).map((creative) => ({
      ...creative,
      accountId: account.accountId,
      accountName: account.name,
    })),
  );
  const diagnosticFacts = buildCampaignDiagnosticFacts(
    campaigns,
    accountLabelById,
    workspace,
  );

  const window = windowDays({
    dateStart: bundle.accounts
      .map((account) => account.accountMetrics?.dateStart)
      .find(Boolean),
    dateStop: bundle.accounts
      .map((account) => account.accountMetrics?.dateStop)
      .find(Boolean),
    datePreset: bundle.datePreset,
  });

  const successfulAccounts = accountRows.filter(
    (account) => !account.error && account.accountMetrics,
  );
  const currencies = [
    ...new Set(
      successfulAccounts
        .map((account) => account.currency?.toUpperCase())
        .filter(Boolean),
    ),
  ] as string[];
  const coverageComplete =
    accountRows.length > 0 && successfulAccounts.length === accountRows.length;
  const allCurrenciesKnown = successfulAccounts.every((account) =>
    Boolean(account.currency),
  );
  const singleCurrency = allCurrenciesKnown && currencies.length === 1;
  const canConsolidate = coverageComplete && singleCurrency;
  const totals = successfulAccounts.reduce((acc, account) => {
    if (!account.accountMetrics) return acc;
    return addMetricTotals(acc, account.accountMetrics);
  }, emptyMetricTotals());

  const cycleDays = payment
    ? billingCycleDays({
        periodStart: payment.periodStart,
        periodEnd: payment.periodEnd,
        commitmentMonths: payment.commitmentMonths,
      })
    : 30;
  const allocatedPlanCost =
    payment && canConsolidate
      ? allocatePlanCost({
          planAmountReais: paymentAmountReais(payment.amountCentavos),
          billingCycleDays: cycleDays,
          windowDays: window,
        })
      : null;
  const reportCurrency = currencies.at(0) ?? null;
  const roasPair = computeRoasPair({
    purchaseValue: canConsolidate ? totals.purchaseValue : 0,
    spend: canConsolidate ? totals.spend : 0,
    allocatedPlanCost,
    spendCurrency: reportCurrency,
    planCurrency: payment?.currency ?? null,
    hasPayment: Boolean(payment),
  });
  const consolidationUnavailableReason = consolidationReason(
    coverageComplete,
    singleCurrency,
  );

  const accountTotals = {
    scope: totalsScope(accountRows.length, coverageComplete),
    consolidated: canConsolidate,
    consolidationUnavailableReason,
    coverage: {
      requestedAccounts: accountRows.length,
      successfulAccounts: successfulAccounts.length,
      complete: coverageComplete,
    },
    currency: reportCurrency,
    period: {
      datePreset: bundle.datePreset,
      since: bundle.since,
      until: bundle.until,
      windowDays: window,
      dateStart:
        bundle.accounts.find((account) => account.accountMetrics?.dateStart)
          ?.accountMetrics?.dateStart ?? null,
      dateStop:
        bundle.accounts.find((account) => account.accountMetrics?.dateStop)
          ?.accountMetrics?.dateStop ?? null,
    },
    gasto: canConsolidate ? totals.spend : null,
    compras: canConsolidate ? totals.purchases : null,
    valorDeCompra: canConsolidate ? totals.purchaseValue : null,
    cpa: canConsolidate ? derivedCpa(totals) : null,
    roasMeta: canConsolidate
      ? (roasPair.roasMeta ?? derivedRoas(totals))
      : null,
    roasAjustado: canConsolidate ? roasPair.roasAdjusted : null,
    impressoes: canConsolidate ? totals.impressions : null,
    cliques: canConsolidate ? totals.clicks : null,
    planCost: payment
      ? {
          source: "Último pagamento sucedido da assinatura atual.",
          paidAmount: paymentAmountReais(payment.amountCentavos),
          currency: payment.currency,
          paidAt: isoDate(payment.paidAt),
          billingCycleDays: cycleDays,
          allocatedToWindow: allocatedPlanCost,
          allocationRule:
            window === 30
              ? "Janela padrão de 30 dias usa um pagamento mensal integral."
              : "Janela não padrão rateia o pagamento pelos dias do ciclo.",
          formula:
            "ROAS Ajustado Automatize = valor de compra ÷ (gasto Meta + custo do plano alocado à janela)",
        }
      : null,
    unavailableReason: canConsolidate
      ? roasPair.unavailableReason
      : consolidationUnavailableReason,
    unavailableReasonLabel: adjustedUnavailableLabel(
      canConsolidate,
      roasPair.unavailableReason,
    ),
    metricOrder: [...ACCOUNT_TOTALS_ORDER],
  };

  const campaignTable = buildCampaignTable(
    campaigns,
    accountRows.length > 1,
    accountLabelById,
  );
  const tableTotals = sumCampaignTable(campaigns);

  return {
    schemaVersion: PERFORMANCE_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    client: {
      userId: client.userId,
      email: client.email,
      name: client.name,
      plano: planLabel(client.planType),
      planType: client.planType,
      renovacao: isoDate(client.renewalDate),
      situacaoMeta: metaSituation(client),
      contasDeAnuncio: accountRows.map((account) => ({
        accountId: account.accountId,
        name: account.name,
        label: accountLabelById[account.accountId] ?? account.name,
        currency: account.currency,
      })),
    },
    accountTotals,
    campaignCount: campaigns.length,
    campaignsComplete: accountRows.every(
      (account) => !account.truncated?.campaigns,
    ),
    tableCoverage: {
      rowCount: campaignTable.rowCount,
      tableGasto: tableTotals.gasto,
      tableCompras: tableTotals.compras,
      tableValorDeCompra: tableTotals.valorDeCompra,
      accountGasto: canConsolidate ? totals.spend : null,
      accountCompras: canConsolidate ? totals.purchases : null,
      accountValorDeCompra: canConsolidate ? totals.purchaseValue : null,
      note: "Totais da conta vêm do insight de conta Meta e podem não bater com a soma das campanhas do HUD. A tabela deve ter rowCount linhas mesmo assim. Não invente linhas para fechar a diferença.",
    },
    campaigns: campaigns.map((campaign) =>
      campaignFact(campaign, accountLabelById, workspace),
    ),
    campaignTable,
    diagnosticFacts,
    creatives: includeCreatives ? creatives : undefined,
    accounts: accountRows.map((account) => ({
      accountId: account.accountId,
      name: account.name,
      label: accountLabelById[account.accountId] ?? account.name,
      currency: account.currency,
      error: account.error,
      accountMetrics: account.accountMetrics,
      campaignCount: account.campaigns.length,
      campaignsTruncated: account.truncated?.campaigns ?? false,
      creativeCount: account.creatives?.length ?? 0,
      creativesTruncated: account.truncated?.ads ?? false,
    })),
    formatting: {
      campaignTableColumns: campaignTable.columns,
      campaignMetricsOrder: [...CAMPAIGN_METRICS_ORDER],
      creativeMetricsOrder: [...CREATIVE_METRICS_ORDER],
    },
  };
}
