"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, X, Info, Pencil, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  type Ad,
  type AdSet,
  type AdSetGeoLocations,
  type AdSetScheduleBlock,
  type AdSetTargeting,
  type CampaignObjective,
  type TargetingEntity,
  type TimeIncrement,
  DatePreset,
} from "@/lib/meta-business/types";
import { InsightsCards } from "./insights-cards";
import { InsightsChart } from "./insights-chart";
import { TimeIncrementSelector } from "./time-increment-selector";
import { AdsTable } from "./ads-table";
import { DateFilter, resolveDateFilterFromParent } from "./date-filter";
import { AdSetEditDialog } from "./adset-edit-dialog";
import { AdSetEditHistory } from "./adset-edit-history";
import { AdCreativeDialog } from "./ad-creative-dialog";
import { AdMediaPreviewDialog } from "./ad-media-preview-dialog";
import { DuplicateButton } from "./duplicate-button";
import { NameEditButton } from "./name-edit-button";
import {
  getStatusBadgeVariant,
  formatDate,
  formatCurrency,
  translateStatus,
  getOptimizationGoalLabel,
  getOptimizationGoalDescription,
} from "../utils/formatters";
import { interestTargetingFromMetaTargeting } from "@/lib/meta-business/interest-targeting-types";
import { useAdSetDetail, useAdSetInsights } from "../hooks/marketing-queries";
import type { CampaignMetricId } from "../utils/campaign-metrics";

type AdSetDetailProps = {
  adSet: AdSet;
  accountId: string;
  userId: string;
  /**
   * Objective of the parent campaign. Controls which metric set is shown in
   * the totals cards and in the ads table inside this sheet, so each level
   * (campaign / adset / ad) renders the same objective-aware metrics.
   */
  objective?: CampaignObjective;
  selectedMetricIds?: CampaignMetricId[] | null;
  isOpen: boolean;
  onClose: () => void;
  /** Called after the ad set is duplicated (parent should refresh its list). */
  onDuplicated?: () => void;
  /** Called after the ad set is renamed (parent should refresh its list). */
  onRenamed?: () => void;
  parentDatePreset?: DatePreset | null;
  parentCustomRange?: { since: string; until: string } | null;
};

export function AdSetDetail({
  adSet: adSetProp,
  accountId,
  userId,
  objective,
  selectedMetricIds,
  isOpen,
  onClose,
  onDuplicated,
  onRenamed,
  parentDatePreset,
  parentCustomRange,
}: AdSetDetailProps) {
  const [adSet, setAdSet] = useState<AdSet>(adSetProp);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [historyRefreshTrigger, setHistoryRefreshTrigger] = useState(0);
  const [isCreateAdOpen, setIsCreateAdOpen] = useState(false);
  const [selectedAdForMedia, setSelectedAdForMedia] = useState<Ad | null>(null);

  useEffect(() => {
    setAdSet(adSetProp);
  }, [adSetProp]);

  const [timeIncrement, setTimeIncrement] = useState<TimeIncrement>("day");
  const [selectedMetric, setSelectedMetric] = useState<
    "spend" | "impressions" | "clicks" | "cpc" | "cpm"
  >("spend");

  const metricOptions = [
    { value: "spend" as const, label: "Gasto" },
    { value: "impressions" as const, label: "Impressões" },
    { value: "clicks" as const, label: "Cliques" },
    { value: "cpc" as const, label: "CPC" },
    { value: "cpm" as const, label: "CPM" },
  ] as const;

  const [datePreset, setDatePreset] = useState<DatePreset | null>(
    DatePreset.LAST_30D,
  );
  const [customRange, setCustomRange] = useState<{
    since: string;
    until: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const resolved = resolveDateFilterFromParent(
      parentDatePreset,
      parentCustomRange,
    );
    setDatePreset(resolved.datePreset);
    setCustomRange(resolved.customRange);
  }, [isOpen, parentDatePreset, parentCustomRange]);

  // Full ad set (with targeting). The /adsets list omits targeting, so the Edit
  // dialog needs this richer payload. Cached and refetched after invalidation.
  const detailQuery = useAdSetDetail(accountId, userId, adSet.id, {
    adsLimit: 1,
    enabled: isOpen || isDetailsOpen,
  });
  const detailedAdSet = detailQuery.data ?? null;
  const isLoadingDetails = detailQuery.isFetching;
  const detailsError = detailQuery.error
    ? "Não foi possível carregar os detalhes do conjunto."
    : null;

  // Insights (time-series + total) cached with a short stale time; mutations to
  // this ad set invalidate them so they refresh.
  const insightsQuery = useAdSetInsights(
    accountId,
    userId,
    adSet.id,
    {
      timeIncrement,
      datePreset,
      since: customRange?.since ?? null,
      until: customRange?.until ?? null,
    },
    { enabled: isOpen },
  );
  const insightsData = insightsQuery.data?.insightsArray ?? [];
  const totalInsights = insightsQuery.data?.total ?? adSet.insights;
  const isLoadingInsights = insightsQuery.isFetching;

  const handleDetailsOpenChange = (open: boolean) => {
    setIsDetailsOpen(open);
  };

  const refetchAdSet = useCallback(async () => {
    try {
      const statuses =
        "ACTIVE,PAUSED,CAMPAIGN_PAUSED,ADSET_PAUSED,PENDING_REVIEW," +
        "DISAPPROVED,PREAPPROVED,WITH_ISSUES,IN_PROCESS";
      const params = new URLSearchParams({
        userId,
        effectiveStatus: statuses,
        limit: "100",
      });
      if (adSet.campaignId) {
        params.set("campaignId", adSet.campaignId);
      }
      const res = await fetch(
        `/api/meta-marketing/${accountId}/adsets?${params}`,
      );
      if (!res.ok) return;
      const data: { data?: AdSet[] } = await res.json();
      const match = data.data?.find((a) => a.id === adSet.id);
      if (match) {
        setAdSet(match);
      }
    } catch {
      // best-effort; the edit already succeeded
    }
  }, [accountId, adSet.id, adSet.campaignId, userId]);

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[75vw] overflow-y-auto p-0"
        >
          <SheetHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/60 px-4 py-3 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="shrink-0 sm:hidden size-8"
                >
                  <ArrowLeft className="size-4" />
                </Button>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <SheetTitle className="line-clamp-1 text-left text-base font-semibold">
                      {adSet.name ?? "Detalhes do Conjunto de Anúncios"}
                    </SheetTitle>
                    <NameEditButton
                      entityType="adset"
                      entityId={adSet.id}
                      currentName={adSet.name}
                      accountId={accountId}
                      userId={userId}
                      onRenamed={(newName) => {
                        setAdSet((prev) => ({ ...prev, name: newName }));
                        onRenamed?.();
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    <Badge
                      variant={getStatusBadgeVariant(adSet.effectiveStatus)}
                      className="text-[10px] py-0 h-4"
                    >
                      {translateStatus(adSet.effectiveStatus ?? adSet.status)}
                    </Badge>
                    {adSet.startTime && (
                      <span className="text-xs text-muted-foreground">
                        Início: {formatDate(adSet.startTime)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <DuplicateButton
                  entityType="adset"
                  entityId={adSet.id}
                  entityName={adSet.name}
                  accountId={accountId}
                  userId={userId}
                  variant="labeled"
                  onDuplicated={() => {
                    onDuplicated?.();
                    onClose();
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDetailsOpenChange(true)}
                  className="shrink-0 h-8 text-xs"
                >
                  Ver detalhes
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditOpen(true)}
                  disabled={!detailedAdSet || isLoadingDetails}
                  title={
                    !detailedAdSet && isLoadingDetails
                      ? "Carregando detalhes do conjunto..."
                      : undefined
                  }
                  className="shrink-0 h-8 text-xs"
                >
                  {isLoadingDetails && !detailedAdSet ? (
                    <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Pencil className="size-3.5 mr-1.5" />
                  )}
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="shrink-0 hidden sm:flex size-8 text-muted-foreground"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          </SheetHeader>

          <div className="px-4 py-5 sm:px-6 sm:py-6 space-y-6">
            {(adSet.dailyBudget || adSet.lifetimeBudget) && (
              <section className="flex flex-wrap gap-4 p-3.5 bg-muted/30 rounded-xl border border-border/40 justify-between">
                {adSet.dailyBudget && (
                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Orçamento Diário
                    </span>
                    <p className="font-semibold text-sm mt-0.5 tabular-nums">
                      {formatCurrency(parseInt(adSet.dailyBudget) / 100)}
                    </p>
                  </div>
                )}
                {adSet.lifetimeBudget && (
                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Orçamento Total
                    </span>
                    <p className="font-semibold text-sm mt-0.5 tabular-nums">
                      {formatCurrency(parseInt(adSet.lifetimeBudget) / 100)}
                    </p>
                  </div>
                )}
                {adSet.budgetRemaining && (
                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Orçamento Restante
                    </span>
                    <p className="font-semibold text-sm mt-0.5 tabular-nums">
                      {formatCurrency(parseInt(adSet.budgetRemaining) / 100)}
                    </p>
                  </div>
                )}
                {adSet.optimizationGoal && (
                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Objetivo de Otimização
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="font-semibold text-sm">
                        {getOptimizationGoalLabel(adSet.optimizationGoal)}
                      </p>
                      <Dialog>
                        <DialogTrigger asChild>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            aria-label="Ver descrição"
                          >
                            <Info className="size-3.5" />
                          </button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>
                              {getOptimizationGoalLabel(adSet.optimizationGoal)}
                            </DialogTitle>
                            <DialogDescription className="text-left pt-2">
                              {getOptimizationGoalDescription(
                                adSet.optimizationGoal,
                              )}
                            </DialogDescription>
                          </DialogHeader>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                )}
              </section>
            )}

            <section>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Período
                </p>
                <DateFilter
                  datePreset={datePreset}
                  onDatePresetChange={(preset) => {
                    setDatePreset(preset);
                    setCustomRange(null);
                  }}
                  customRange={customRange}
                  onCustomRangeChange={(range) => {
                    setCustomRange(range);
                    setDatePreset(null);
                  }}
                />
              </div>
            </section>

            <section>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Métricas Totais
              </p>
              <InsightsCards
                insights={totalInsights}
                isLoading={isLoadingInsights}
                objective={objective}
              />
            </section>

            <section>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Desempenho ao Longo do Tempo
                </p>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2.5">
                  <TimeIncrementSelector
                    value={timeIncrement}
                    onChange={setTimeIncrement}
                    disabled={isLoadingInsights}
                  />
                  <Select
                    value={selectedMetric}
                    onValueChange={(v) =>
                      setSelectedMetric(v as typeof selectedMetric)
                    }
                  >
                    <SelectTrigger className="w-full sm:w-[130px] h-8 text-xs">
                      <SelectValue placeholder="Selecione uma métrica" />
                    </SelectTrigger>
                    <SelectContent>
                      {metricOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <InsightsChart
                data={insightsData}
                isLoading={isLoadingInsights}
                metric={selectedMetric}
              />
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Anúncios
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setIsCreateAdOpen(true)}
                >
                  <Plus className="mr-1.5 size-3.5" />
                  Criar anúncio
                </Button>
              </div>
              <AdsTable
                accountId={accountId}
                userId={userId}
                adSetId={adSet.id}
                adSetIsDynamic={adSet.isDynamicCreative === true}
                objective={objective}
                datePreset={datePreset}
                customRange={customRange}
                selectedMetricIds={selectedMetricIds}
                onMediaClick={(ad) => setSelectedAdForMedia(ad)}
              />
            </section>

            <section>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Histórico de Alterações
              </p>
              <AdSetEditHistory
                adsetId={adSet.id}
                accountId={accountId}
                userId={userId}
                refreshTrigger={historyRefreshTrigger}
              />
            </section>
          </div>
        </SheetContent>
      </Sheet>

      <AdSetEditDialog
        adSet={detailedAdSet ?? adSet}
        accountId={accountId}
        userId={userId}
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        onSuccess={() => {
          setHistoryRefreshTrigger((prev) => prev + 1);
          refetchAdSet();
        }}
      />

      {isCreateAdOpen && (
        <AdCreativeDialog
          mode="create"
          accountId={accountId}
          userId={userId}
          adsetId={adSet.id}
          adsetName={adSet.name}
          adSetIsDynamic={adSet.isDynamicCreative === true}
          isOpen={isCreateAdOpen}
          onClose={() => setIsCreateAdOpen(false)}
        />
      )}

      <Dialog open={isDetailsOpen} onOpenChange={handleDetailsOpenChange}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto p-0">
          <AdSetDetailsDialogContent
            adSet={detailedAdSet ?? adSet}
            isLoading={isLoadingDetails}
            error={detailsError}
            onRetry={() => detailQuery.refetch()}
          />
        </DialogContent>
      </Dialog>

      <AdMediaPreviewDialog
        open={selectedAdForMedia !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedAdForMedia(null);
        }}
        accountId={accountId}
        userId={userId}
        ad={selectedAdForMedia}
      />
    </>
  );
}

type AdSetDetailsDialogContentProps = {
  adSet: AdSet;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
};

function AdSetDetailsDialogContent({
  adSet,
  isLoading,
  error,
  onRetry,
}: AdSetDetailsDialogContentProps) {
  const targeting = adSet.targeting;
  const campaign = adSet.campaign;
  const hasCampaignBudget = Boolean(
    campaign?.dailyBudget || campaign?.lifetimeBudget,
  );
  const dayNames = [
    "Domingo",
    "Segunda",
    "Terça",
    "Quarta",
    "Quinta",
    "Sexta",
    "Sábado",
  ];

  return (
    <div>
      <DialogHeader className="border-b border-border/60 px-5 py-4 pr-12 text-left">
        <DialogTitle>Detalhes do conjunto</DialogTitle>
        <DialogDescription className="line-clamp-2">
          {adSet.name ?? "Conjunto de anúncios"}
        </DialogDescription>
      </DialogHeader>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-3 px-5 py-12 text-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Carregando detalhes do conjunto...
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-3 px-5 py-12 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <div className="space-y-4 px-5 py-5">
          <DetailSection title="Público">
            <DetailRow
              label="Localizações"
              values={formatGeoLocations(targeting?.geo_locations)}
              empty="Não informado"
            />
            <DetailRow
              label="Localizações excluídas"
              values={formatGeoLocations(targeting?.excluded_geo_locations)}
              empty="Não informado"
            />
            <DetailRow
              label="Idade"
              value={formatAgeRange(targeting)}
              empty="Não informado"
            />
            <DetailRow
              label="Gênero"
              values={formatGenders(targeting?.genders)}
              empty="Todos"
            />
            <DetailRow
              label="Públicos personalizados"
              values={formatEntities(targeting?.custom_audiences)}
              empty="Não informado"
            />
            <DetailRow
              label="Públicos personalizados excluídos"
              values={formatEntities(targeting?.excluded_custom_audiences)}
              empty="Não informado"
            />
            <DetailRow
              label="Interesses incluídos"
              values={formatIncludedInterests(targeting)}
              empty="Não informado"
            />
            <DetailRow
              label="Interesses excluídos"
              values={formatExcludedInterests(targeting)}
              empty="Não informado"
            />
            <DetailRow
              label="Direcionamento detalhado"
              values={formatDetailedTargeting(targeting)}
              empty="Não informado"
            />
            <DetailRow
              label="Idioma"
              values={formatLocales(targeting?.locales)}
              empty="Todos"
            />
          </DetailSection>

          <DetailSection title="Posicionamentos">
            <DetailRow
              label="Plataformas"
              values={formatMetaValues(targeting?.publisher_platforms)}
              empty="Não informado"
            />
            <DetailRow
              label="Posicionamentos no Facebook"
              values={formatMetaValues(targeting?.facebook_positions)}
              empty="Não informado"
            />
            <DetailRow
              label="Posicionamentos no Instagram"
              values={formatMetaValues(targeting?.instagram_positions)}
              empty="Não informado"
            />
            <DetailRow
              label="Posicionamentos no Messenger"
              values={formatMetaValues(targeting?.messenger_positions)}
              empty="Não informado"
            />
            <DetailRow
              label="Posicionamentos na Audience Network"
              values={formatMetaValues(targeting?.audience_network_positions)}
              empty="Não informado"
            />
            <DetailRow
              label="Dispositivos"
              values={formatMetaValues(targeting?.device_platforms)}
              empty="Não informado"
            />
          </DetailSection>

          <DetailSection title="Orçamento e datas">
            <DetailRow
              label="Origem do orçamento"
              value={
                hasCampaignBudget
                  ? "Orçamento da campanha (CBO)"
                  : "Orçamento do conjunto (ABO)"
              }
              empty="Não informado"
            />
            <DetailRow
              label="Orçamento diário"
              value={formatBudgetCents(
                hasCampaignBudget ? campaign?.dailyBudget : adSet.dailyBudget,
              )}
              empty="Não informado"
            />
            <DetailRow
              label="Orçamento total"
              value={formatBudgetCents(
                hasCampaignBudget
                  ? campaign?.lifetimeBudget
                  : adSet.lifetimeBudget,
              )}
              empty="Não informado"
            />
            {campaign?.isAdsetBudgetSharingEnabled !== undefined && (
              <DetailRow
                label="Compartilhamento entre conjuntos"
                value={campaign.isAdsetBudgetSharingEnabled ? "Sim" : "Não"}
                empty="Não informado"
              />
            )}
            <DetailRow
              label="Data de início"
              value={formatDate(adSet.startTime)}
              empty="Não informado"
            />
            <DetailRow
              label="Hora de início"
              value={formatTime(adSet.startTime)}
              empty="Não informado"
            />
            <DetailRow
              label="Data de término"
              value={formatDate(adSet.endTime)}
              empty="Não informado"
            />
            <DetailRow
              label="Hora de término"
              value={formatTime(adSet.endTime)}
              empty="Não informado"
            />
          </DetailSection>

          <DetailSection title="Veiculação">
            <DetailRow
              label="Veiculação"
              values={formatPacingType(adSet.pacingType)}
              empty="Não informado"
            />
            <DetailRow
              label="Dias e horários"
              values={formatScheduleBlocks(adSet.adsetSchedule, dayNames)}
              empty="Todos os dias e horários"
            />
            {adSet.targetingSentenceLines &&
              adSet.targetingSentenceLines.length > 0 && (
                <DetailRow
                  label="Resumo da Meta"
                  values={adSet.targetingSentenceLines
                    .map((line) => line.content)
                    .filter((line): line is string => Boolean(line))}
                  empty="Não informado"
                />
              )}
          </DetailSection>
        </div>
      )}
    </div>
  );
}

type DetailSectionProps = {
  title: string;
  children: React.ReactNode;
};

function DetailSection({ title, children }: DetailSectionProps) {
  return (
    <section className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

type DetailRowProps = {
  label: string;
  value?: string;
  values?: string[];
  empty: string;
};

function DetailRow({ label, value, values, empty }: DetailRowProps) {
  const items = values ?? (value && value !== "-" ? [value] : []);

  return (
    <div className="space-y-1.5">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd>
        {items.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {items.map((item, index) => (
              <Badge
                key={`${item}-${index}`}
                variant="outline"
                className="max-w-full wrap-break-word rounded-md bg-background px-2 py-1 text-left text-[11px] font-normal leading-relaxed"
              >
                {item}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">{empty}</span>
        )}
      </dd>
    </div>
  );
}

function formatBudgetCents(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return undefined;

  return formatCurrency(parsed / 100);
}

function formatTime(dateString: string | null | undefined): string | undefined {
  if (!dateString) return undefined;

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return undefined;

  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAgeRange(
  targeting: AdSetTargeting | undefined,
): string | undefined {
  if (!targeting?.age_min && !targeting?.age_max) return undefined;

  const min = targeting.age_min ?? 18;
  const max = targeting.age_max ? String(targeting.age_max) : "65+";

  return `${min} - ${max}`;
}

function formatGenders(genders: number[] | undefined): string[] {
  if (!genders || genders.length === 0) return [];

  const labels: Record<number, string> = {
    1: "Masculino",
    2: "Feminino",
  };

  return genders.map((gender) => labels[gender] ?? String(gender));
}

function formatLocales(locales: number[] | undefined): string[] {
  return locales?.map((locale) => `ID ${locale}`) ?? [];
}

function formatMetaValues(values: string[] | undefined): string[] {
  return values?.map(formatMetaValue) ?? [];
}

function formatMetaValue(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatEntities(entities: TargetingEntity[] | undefined): string[] {
  return entities?.map(formatEntity).filter(Boolean) ?? [];
}

function formatEntity(entity: TargetingEntity): string {
  const name = entity.name ?? entity.key ?? entity.id;
  const region = readPrimitive(entity, "region");
  const country = readPrimitive(entity, "country");
  const details = [region, country].filter(Boolean).join(", ");

  if (!name) return details;
  return details ? `${name} (${details})` : name;
}

function formatGeoLocations(
  geoLocations: AdSetGeoLocations | undefined,
): string[] {
  if (!geoLocations) return [];

  return [
    ...(geoLocations.countries?.map((country) => `País: ${country}`) ?? []),
    ...(geoLocations.country_groups?.map((group) => `Grupo: ${group}`) ?? []),
    ...(geoLocations.regions?.map(
      (region) => `Região: ${formatEntity(region)}`,
    ) ?? []),
    ...(geoLocations.cities?.map((city) => `Cidade: ${formatEntity(city)}`) ??
      []),
    ...(geoLocations.zips?.map((zip) => `CEP: ${formatEntity(zip)}`) ?? []),
    ...(geoLocations.geo_markets?.map(
      (market) => `Mercado: ${formatEntity(market)}`,
    ) ?? []),
    ...(geoLocations.custom_locations?.map(formatCustomLocation) ?? []),
    ...(geoLocations.location_types?.map(
      (type) => `Tipo: ${formatMetaValue(type)}`,
    ) ?? []),
  ].filter(Boolean);
}

function formatCustomLocation(location: TargetingEntity): string {
  const address = readPrimitive(location, "address_string") ?? location.name;
  const latitude = readPrimitive(location, "latitude");
  const longitude = readPrimitive(location, "longitude");
  const radius = readPrimitive(location, "radius");
  const distanceUnit = readPrimitive(location, "distance_unit");
  const coordinates =
    latitude && longitude ? `${latitude}, ${longitude}` : undefined;
  const base = address ?? coordinates ?? location.key ?? location.id ?? "";

  if (radius) {
    return `${base} (${radius}${distanceUnit ? ` ${distanceUnit}` : ""})`;
  }

  return base;
}

function formatDetailedTargeting(
  targeting: AdSetTargeting | undefined,
): string[] {
  if (!targeting) return [];

  const directSegments = [
    ...(targeting.behaviors?.map(
      (item) => `Comportamento: ${formatEntity(item)}`,
    ) ?? []),
    ...(targeting.demographics?.map(
      (item) => `Demográfico: ${formatEntity(item)}`,
    ) ?? []),
  ];

  const flexibleSegments =
    targeting.flexible_spec?.flatMap((spec, specIndex) =>
      Object.entries(spec).flatMap(([key, entities]) => {
        if (key === "interests") return [];
        return (
          entities?.map(
            (entity) =>
              `${formatMetaValue(key)} ${specIndex + 1}: ${formatEntity(entity)}`,
          ) ?? []
        );
      }),
    ) ?? [];

  return [...directSegments, ...flexibleSegments];
}

function formatIncludedInterests(
  targeting: AdSetTargeting | undefined,
): string[] {
  const value = interestTargetingFromMetaTargeting(targeting);
  const nonEmptyGroups = value.includeGroups.filter(
    (group) => group.interests.length > 0,
  );

  if (nonEmptyGroups.length <= 1) {
    return nonEmptyGroups.flatMap((group) =>
      group.interests.map((interest) => interest.name),
    );
  }

  return nonEmptyGroups.map((group, index) => {
    const names = group.interests.map((interest) => interest.name).join(", ");
    return `Grupo ${index + 1}: ${names}`;
  });
}

function formatExcludedInterests(
  targeting: AdSetTargeting | undefined,
): string[] {
  return interestTargetingFromMetaTargeting(targeting).exclusions.map(
    (interest) => interest.name,
  );
}

function formatPacingType(pacingType: string[] | string | undefined): string[] {
  if (!pacingType) return [];

  const values = Array.isArray(pacingType) ? pacingType : [pacingType];
  return values.map(formatMetaValue);
}

function formatScheduleBlocks(
  scheduleBlocks: AdSetScheduleBlock[] | undefined,
  dayNames: string[],
): string[] {
  if (!scheduleBlocks || scheduleBlocks.length === 0) return [];

  return scheduleBlocks.map((block) => {
    const days =
      block.days
        ?.map((day) => dayNames[day] ?? String(day))
        .filter(Boolean)
        .join(", ") ?? "Todos os dias";
    const start = formatMinuteOfDay(block.start_minute);
    const end = formatMinuteOfDay(block.end_minute);
    const timezone = block.timezone_type
      ? ` (${formatMetaValue(block.timezone_type)})`
      : "";

    return `${days}: ${start} - ${end}${timezone}`;
  });
}

function formatMinuteOfDay(minute: number | undefined): string {
  if (minute === undefined) return "--:--";

  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0",
  )}`;
}

function readPrimitive(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return undefined;
}
