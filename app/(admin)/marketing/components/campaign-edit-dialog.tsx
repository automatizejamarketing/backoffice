"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  AdSet,
  Campaign,
  CampaignAdSetBudgetInput,
  CampaignBudgetMode,
} from "@/lib/meta-business/types";
import {
  dateTimeLocalToMeta,
  getBudgetType,
  metaDateToDateTimeLocal,
  minorUnitsToCurrencyInput,
  type BudgetType,
} from "@/lib/meta-business/budget-schedule";
import { formatCurrency } from "../utils/formatters";

type CampaignEditDialogProps = {
  campaign: Campaign;
  accountId: string;
  userId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (campaign: Campaign) => void;
};

type GetAdSetsResponse = {
  data?: AdSet[];
};

type PatchCampaignResponse = {
  success: boolean;
  campaign?: Campaign;
  auditLogFailed?: boolean;
  auditLogError?: string;
};

function parsePositiveMinorUnits(value?: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function CampaignEditDialog({
  campaign,
  accountId,
  userId,
  isOpen,
  onClose,
  onSuccess,
}: CampaignEditDialogProps) {
  const currentDailyBudgetValue = useMemo(() => {
    if (!campaign.dailyBudget) return null;
    const parsed = Number.parseInt(campaign.dailyBudget, 10);
    return Number.isNaN(parsed) ? null : parsed / 100;
  }, [campaign.dailyBudget]);
  const currentLifetimeBudgetValue = useMemo(() => {
    if (!campaign.lifetimeBudget) return null;
    const parsed = Number.parseInt(campaign.lifetimeBudget, 10);
    return Number.isNaN(parsed) ? null : parsed / 100;
  }, [campaign.lifetimeBudget]);
  const currentBudgetType = getBudgetType(campaign);

  const [selectedMode, setSelectedMode] = useState<CampaignBudgetMode>(
    campaign.budgetMode,
  );
  const [selectedBudgetType, setSelectedBudgetType] =
    useState<BudgetType>(currentBudgetType);
  const [dailyBudget, setDailyBudget] = useState<string>(
    minorUnitsToCurrencyInput(campaign.dailyBudget),
  );
  const [lifetimeBudget, setLifetimeBudget] = useState<string>(
    minorUnitsToCurrencyInput(campaign.lifetimeBudget),
  );
  const [startTime, setStartTime] = useState<string>(
    metaDateToDateTimeLocal(campaign.startTime),
  );
  const [endTime, setEndTime] = useState<string>(
    metaDateToDateTimeLocal(campaign.stopTime),
  );
  const [note, setNote] = useState("");
  const [adSets, setAdSets] = useState<AdSet[]>([]);
  const [adSetBudgetTypes, setAdSetBudgetTypes] = useState<
    Record<string, BudgetType>
  >({});
  const [adSetBudgetValues, setAdSetBudgetValues] = useState<
    Record<string, string>
  >({});
  const [adSetLifetimeBudgetValues, setAdSetLifetimeBudgetValues] = useState<
    Record<string, string>
  >({});
  const [adSetStartTimes, setAdSetStartTimes] = useState<Record<string, string>>(
    {},
  );
  const [adSetEndTimes, setAdSetEndTimes] = useState<Record<string, string>>(
    {},
  );
  const [isLoadingAdSets, setIsLoadingAdSets] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shouldLoadAdSets =
    isOpen && (selectedMode === "ABO" || campaign.budgetMode === "ABO");
  const hasLifetimeAdSets = adSets.some(
    (adSet) => getBudgetType(adSet) === "lifetime",
  );
  const mustUseLifetimeBudget =
    campaign.budgetMode === "ABO" && selectedMode === "CBO" && hasLifetimeAdSets;
  const displayedBudgetType: BudgetType = mustUseLifetimeBudget
    ? "lifetime"
    : selectedBudgetType;
  const isModeChanged = selectedMode !== campaign.budgetMode;
  const isBudgetTypeChanged = selectedBudgetType !== currentBudgetType;
  const isCboBudgetChanged =
    selectedMode === "CBO" &&
    selectedBudgetType === "daily" &&
    currentDailyBudgetValue !== Number.parseFloat(dailyBudget || "NaN");
  const isCboLifetimeBudgetChanged =
    selectedMode === "CBO" &&
    selectedBudgetType === "lifetime" &&
    currentLifetimeBudgetValue !== Number.parseFloat(lifetimeBudget || "NaN");
  const isCboScheduleChanged =
    selectedMode === "CBO" &&
    selectedBudgetType === "lifetime" &&
    (metaDateToDateTimeLocal(campaign.startTime) !== startTime ||
      metaDateToDateTimeLocal(campaign.stopTime) !== endTime);

  const fetchAdSets = useCallback(async () => {
    if (!shouldLoadAdSets) return;

    setIsLoadingAdSets(true);
    try {
      const params = new URLSearchParams({
        userId,
        campaignId: campaign.id,
        limit: "100",
      });
      const response = await fetch(
        `/api/meta-marketing/${accountId}/adsets?${params}`,
      );

      if (!response.ok) {
        throw new Error("Falha ao carregar os conjuntos de anúncios");
      }

      const data: GetAdSetsResponse = await response.json();
      const nextAdSets = data.data ?? [];
      setAdSets(nextAdSets);

      const lifetimeAdSets = nextAdSets.filter(
        (adSet) => getBudgetType(adSet) === "lifetime",
      );
      if (campaign.budgetMode === "ABO" && lifetimeAdSets.length > 0) {
        const lifetimeBudgetMinorUnits = lifetimeAdSets.reduce(
          (total, adSet) =>
            total + (parsePositiveMinorUnits(adSet.lifetimeBudget) ?? 0),
          0,
        );

        setSelectedBudgetType("lifetime");
        setLifetimeBudget((prev) =>
          prev || (lifetimeBudgetMinorUnits / 100).toFixed(2),
        );
        setStartTime(
          (prev) =>
            prev ||
            metaDateToDateTimeLocal(campaign.startTime) ||
            metaDateToDateTimeLocal(lifetimeAdSets[0]?.startTime),
        );
        setEndTime(
          (prev) =>
            prev ||
            metaDateToDateTimeLocal(campaign.stopTime) ||
            metaDateToDateTimeLocal(lifetimeAdSets[0]?.endTime),
        );
      }

      setAdSetBudgetTypes((prev) => {
        const nextValues: Record<string, BudgetType> = {};
        for (const adSet of nextAdSets) {
          nextValues[adSet.id] = prev[adSet.id] ?? getBudgetType(adSet);
        }
        return nextValues;
      });
      setAdSetBudgetValues((prev) => {
        const nextValues: Record<string, string> = {};
        for (const adSet of nextAdSets) {
          nextValues[adSet.id] =
            prev[adSet.id] ?? minorUnitsToCurrencyInput(adSet.dailyBudget);
        }
        return nextValues;
      });
      setAdSetLifetimeBudgetValues((prev) => {
        const nextValues: Record<string, string> = {};
        for (const adSet of nextAdSets) {
          nextValues[adSet.id] =
            prev[adSet.id] ??
            minorUnitsToCurrencyInput(adSet.lifetimeBudget);
        }
        return nextValues;
      });
      setAdSetStartTimes((prev) => {
        const nextValues: Record<string, string> = {};
        for (const adSet of nextAdSets) {
          nextValues[adSet.id] =
            prev[adSet.id] ?? metaDateToDateTimeLocal(adSet.startTime);
        }
        return nextValues;
      });
      setAdSetEndTimes((prev) => {
        const nextValues: Record<string, string> = {};
        for (const adSet of nextAdSets) {
          nextValues[adSet.id] =
            prev[adSet.id] ?? metaDateToDateTimeLocal(adSet.endTime);
        }
        return nextValues;
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Falha ao carregar os conjuntos de anúncios",
      );
    } finally {
      setIsLoadingAdSets(false);
    }
  }, [
    accountId,
    campaign.budgetMode,
    campaign.id,
    campaign.startTime,
    campaign.stopTime,
    shouldLoadAdSets,
    userId,
  ]);

  useEffect(() => {
    if (!isOpen) return;

    setSelectedMode(campaign.budgetMode);
    setSelectedBudgetType(getBudgetType(campaign));
    setDailyBudget(minorUnitsToCurrencyInput(campaign.dailyBudget));
    setLifetimeBudget(minorUnitsToCurrencyInput(campaign.lifetimeBudget));
    setStartTime(metaDateToDateTimeLocal(campaign.startTime));
    setEndTime(metaDateToDateTimeLocal(campaign.stopTime));
    setNote("");
    setError(null);
    setAdSets([]);
    setAdSetBudgetTypes({});
    setAdSetBudgetValues({});
    setAdSetLifetimeBudgetValues({});
    setAdSetStartTimes({});
    setAdSetEndTimes({});
  }, [campaign, isOpen]);

  useEffect(() => {
    if (!shouldLoadAdSets) return;
    void fetchAdSets();
  }, [fetchAdSets, shouldLoadAdSets]);

  useEffect(() => {
    if (!mustUseLifetimeBudget || selectedBudgetType === "lifetime") return;
    setSelectedBudgetType("lifetime");
  }, [mustUseLifetimeBudget, selectedBudgetType]);

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!note.trim()) {
      setError("A nota explicativa é obrigatória");
      return;
    }

    if (campaign.budgetMode === "ABO" && selectedMode === "CBO" && isLoadingAdSets) {
      setError(
        "Aguarde carregar os conjuntos de anúncios antes de salvar a mudança para CBO.",
      );
      return;
    }

    const body: Record<string, unknown> = {
      campaignId: campaign.id,
      campaignName: campaign.name,
      mode: selectedMode,
      budgetType: mustUseLifetimeBudget ? "lifetime" : selectedBudgetType,
      note: note.trim(),
    };

    if (selectedMode === "CBO") {
      const effectiveBudgetType = mustUseLifetimeBudget
        ? "lifetime"
        : selectedBudgetType;

      if (
        !isModeChanged &&
        !isBudgetTypeChanged &&
        !isCboBudgetChanged &&
        !isCboLifetimeBudgetChanged &&
        !isCboScheduleChanged
      ) {
        setError("Nenhuma alteração foi feita");
        return;
      }

      if (effectiveBudgetType === "daily") {
        const budgetValue = Number.parseFloat(dailyBudget);
        if (Number.isNaN(budgetValue) || budgetValue < 1) {
          setError("Informe um orçamento diário válido de pelo menos R$ 1,00");
          return;
        }

        body.dailyBudget = budgetValue;
      } else {
        const budgetValue = Number.parseFloat(lifetimeBudget);
        if (Number.isNaN(budgetValue) || budgetValue < 1) {
          setError("Informe um orçamento total válido de pelo menos R$ 1,00");
          return;
        }

        if (!startTime || !endTime || new Date(endTime) <= new Date(startTime)) {
          setError(
            "Informe início e término válidos. O término deve ser posterior ao início.",
          );
          return;
        }

        body.lifetimeBudget = budgetValue;
        body.startTime = dateTimeLocalToMeta(startTime);
        body.endTime = dateTimeLocalToMeta(endTime);
      }
    } else {
      if (!adSets.length) {
        setError(
          "Nenhum conjunto de anúncios foi encontrado para configurar ABO.",
        );
        return;
      }

      const adsetBudgets: CampaignAdSetBudgetInput[] = [];
      let hasAdSetChange = isModeChanged;

      for (const adSet of adSets) {
        const adSetBudgetType = adSetBudgetTypes[adSet.id] ?? getBudgetType(adSet);
        const currentAdSetBudgetType = getBudgetType(adSet);

        if (adSetBudgetType === "daily") {
          const rawValue = adSetBudgetValues[adSet.id];
          const parsedValue = Number.parseFloat(rawValue);

          if (Number.isNaN(parsedValue) || parsedValue < 1) {
            setError(
              `Defina um orçamento diário válido para o conjunto "${adSet.name ?? adSet.id}".`,
            );
            return;
          }

          hasAdSetChange =
            hasAdSetChange ||
            currentAdSetBudgetType !== "daily" ||
            minorUnitsToCurrencyInput(adSet.dailyBudget) !== rawValue;

          adsetBudgets.push({
            adsetId: adSet.id,
            adsetName: adSet.name,
            budgetType: "daily",
            dailyBudget: parsedValue,
          });
        } else {
          const rawValue = adSetLifetimeBudgetValues[adSet.id];
          const parsedValue = Number.parseFloat(rawValue);
          const nextStartTime = adSetStartTimes[adSet.id];
          const nextEndTime = adSetEndTimes[adSet.id];

          if (Number.isNaN(parsedValue) || parsedValue < 1) {
            setError(
              `Defina um orçamento total válido para o conjunto "${adSet.name ?? adSet.id}".`,
            );
            return;
          }

          if (
            !nextStartTime ||
            !nextEndTime ||
            new Date(nextEndTime) <= new Date(nextStartTime)
          ) {
            setError(
              `Defina início e término válidos para o conjunto "${adSet.name ?? adSet.id}".`,
            );
            return;
          }

          hasAdSetChange =
            hasAdSetChange ||
            currentAdSetBudgetType !== "lifetime" ||
            minorUnitsToCurrencyInput(adSet.lifetimeBudget) !== rawValue ||
            metaDateToDateTimeLocal(adSet.startTime) !== nextStartTime ||
            metaDateToDateTimeLocal(adSet.endTime) !== nextEndTime;

          adsetBudgets.push({
            adsetId: adSet.id,
            adsetName: adSet.name,
            budgetType: "lifetime",
            lifetimeBudget: parsedValue,
            startTime: dateTimeLocalToMeta(nextStartTime),
            endTime: dateTimeLocalToMeta(nextEndTime),
          });
        }
      }

      if (!hasAdSetChange) {
        setError("Nenhuma alteração foi feita");
        return;
      }

      body.adsetBudgets = adsetBudgets;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/meta-marketing/${accountId}/campaigns?userId=${userId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      const responseData: PatchCampaignResponse = await response.json();
      if (!response.ok) {
        throw new Error(
          (responseData as { message?: string }).message ??
            "Falha ao salvar alterações da campanha",
        );
      }

      if (!responseData.campaign) {
        throw new Error(
          "A campanha foi salva, mas a resposta retornou incompleta.",
        );
      }

      onSuccess(responseData.campaign);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Falha ao salvar alterações da campanha",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Campanha</DialogTitle>
          <DialogDescription>
            Altere o modelo de orçamento da campanha entre ABO e CBO. Todas as
            alterações são registradas para auditoria.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Modo de orçamento</Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    {
                      value: "ABO" as const,
                      label: "ABO",
                      description:
                        "Orçamento definido por conjunto de anúncios.",
                    },
                    {
                      value: "CBO" as const,
                      label: "CBO",
                      description:
                        "Orçamento definido no nível da campanha.",
                    },
                  ] as const
                ).map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={
                      selectedMode === option.value ? "default" : "outline"
                    }
                    className="h-auto flex-col items-start gap-1 p-4 text-left"
                    disabled={isSubmitting}
                    onClick={() => setSelectedMode(option.value)}
                  >
                    <span className="text-sm font-semibold">
                      {option.label}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-normal">
                      {option.description}
                    </span>
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Atual:{" "}
                <span className="font-medium text-foreground">
                  {campaign.budgetMode}
                </span>
              </p>
            </div>

            {selectedMode === "CBO" && (
              <div className="space-y-2">
                <Label>Tipo de orçamento</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      {
                        value: "daily" as const,
                        label: "Diário",
                        description: "Gasto médio por dia.",
                      },
                      {
                        value: "lifetime" as const,
                        label: "Total",
                        description: "Valor total com início e término.",
                      },
                    ] as const
                  ).map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      variant={
                        displayedBudgetType === option.value
                          ? "default"
                          : "outline"
                      }
                      className="h-auto flex-col items-start gap-1 p-3 text-left"
                      disabled={
                        isSubmitting ||
                        (mustUseLifetimeBudget && option.value === "daily")
                      }
                      onClick={() => {
                        if (mustUseLifetimeBudget && option.value === "daily") {
                          return;
                        }
                        setSelectedBudgetType(option.value);
                      }}
                    >
                      <span className="text-sm font-semibold">
                        {option.label}
                      </span>
                      <span className="text-xs text-muted-foreground whitespace-normal">
                        {option.description}
                      </span>
                    </Button>
                  ))}
                </div>
                {mustUseLifetimeBudget && (
                  <p className="text-xs text-muted-foreground rounded-md bg-muted p-3">
                    Esta campanha usa orçamento total nos conjuntos de anúncios.
                    Para migrar para CBO, a campanha precisa continuar como
                    orçamento total.
                  </p>
                )}
              </div>
            )}

            {selectedMode === "CBO" ? (
              <div className="space-y-3">
                {displayedBudgetType === "daily" ? (
                  <div className="space-y-2">
                    <Label htmlFor="campaignDailyBudget">
                      Orçamento diário da campanha (R$)
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="campaignDailyBudget"
                        type="number"
                        min="1"
                        step="0.01"
                        value={dailyBudget}
                        onChange={(e) => setDailyBudget(e.target.value)}
                        placeholder="Ex: 120.00"
                        disabled={isSubmitting}
                      />
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        Atual:{" "}
                        {currentDailyBudgetValue === null
                          ? "-"
                          : formatCurrency(currentDailyBudgetValue)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="campaignLifetimeBudget">
                        Orçamento total da campanha (R$)
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="campaignLifetimeBudget"
                          type="number"
                          min="1"
                          step="0.01"
                          value={lifetimeBudget}
                          onChange={(e) => setLifetimeBudget(e.target.value)}
                          placeholder="Ex: 1500.00"
                          disabled={isSubmitting}
                        />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          Atual:{" "}
                          {currentLifetimeBudgetValue === null
                            ? "-"
                            : formatCurrency(currentLifetimeBudgetValue)}
                        </span>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="campaignStartTime">
                          Início da campanha
                        </Label>
                        <Input
                          id="campaignStartTime"
                          type="datetime-local"
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                          disabled={isSubmitting}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="campaignEndTime">
                          Término da campanha
                        </Label>
                        <Input
                          id="campaignEndTime"
                          type="datetime-local"
                          value={endTime}
                          onChange={(e) => setEndTime(e.target.value)}
                          disabled={isSubmitting}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      A Meta aplica o período nos conjuntos de anúncios; ao
                      salvar, todos os conjuntos desta campanha serão atualizados.
                    </p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Quando CBO está ativo, a Meta distribui o orçamento entre os
                  conjuntos da campanha.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  Em ABO, o orçamento fica em cada conjunto de anúncios.
                  Orçamento total exige início e término por conjunto.
                </div>

                {isLoadingAdSets ? (
                  <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Carregando conjuntos de anúncios...
                  </div>
                ) : (
                  <div className="space-y-3">
                    {adSets.map((adSet) => {
                      const adSetBudgetType =
                        adSetBudgetTypes[adSet.id] ?? getBudgetType(adSet);

                      return (
                        <div
                          key={adSet.id}
                          className="rounded-lg border border-border p-3 space-y-3"
                        >
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="font-medium text-sm">
                                {adSet.name ?? adSet.id}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Atual:{" "}
                                {adSet.lifetimeBudget
                                  ? `total ${formatCurrency(
                                      Number.parseInt(
                                        adSet.lifetimeBudget,
                                        10,
                                      ) / 100,
                                    )}`
                                  : adSet.dailyBudget
                                    ? `diário ${formatCurrency(
                                        Number.parseInt(
                                          adSet.dailyBudget,
                                          10,
                                        ) / 100,
                                      )}`
                                    : "sem orçamento individual"}
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            {(["daily", "lifetime"] as const).map((type) => (
                              <Button
                                key={type}
                                type="button"
                                variant={
                                  adSetBudgetType === type
                                    ? "default"
                                    : "outline"
                                }
                                size="sm"
                                disabled={isSubmitting}
                                onClick={() =>
                                  setAdSetBudgetTypes((prev) => ({
                                    ...prev,
                                    [adSet.id]: type,
                                  }))
                                }
                              >
                                {type === "daily" ? "Diário" : "Total"}
                              </Button>
                            ))}
                          </div>

                          {adSetBudgetType === "daily" ? (
                            <div className="space-y-2">
                              <Label htmlFor={`adset-budget-${adSet.id}`}>
                                Orçamento diário do conjunto (R$)
                              </Label>
                              <Input
                                id={`adset-budget-${adSet.id}`}
                                type="number"
                                min="1"
                                step="0.01"
                                value={adSetBudgetValues[adSet.id] ?? ""}
                                onChange={(e) =>
                                  setAdSetBudgetValues((prev) => ({
                                    ...prev,
                                    [adSet.id]: e.target.value,
                                  }))
                                }
                                placeholder="Ex: 50.00"
                                disabled={isSubmitting}
                              />
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="space-y-2">
                                <Label
                                  htmlFor={`adset-lifetime-budget-${adSet.id}`}
                                >
                                  Orçamento total do conjunto (R$)
                                </Label>
                                <Input
                                  id={`adset-lifetime-budget-${adSet.id}`}
                                  type="number"
                                  min="1"
                                  step="0.01"
                                  value={
                                    adSetLifetimeBudgetValues[adSet.id] ?? ""
                                  }
                                  onChange={(e) =>
                                    setAdSetLifetimeBudgetValues((prev) => ({
                                      ...prev,
                                      [adSet.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="Ex: 500.00"
                                  disabled={isSubmitting}
                                />
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-2">
                                  <Label htmlFor={`adset-start-${adSet.id}`}>
                                    Início
                                  </Label>
                                  <Input
                                    id={`adset-start-${adSet.id}`}
                                    type="datetime-local"
                                    value={adSetStartTimes[adSet.id] ?? ""}
                                    onChange={(e) =>
                                      setAdSetStartTimes((prev) => ({
                                        ...prev,
                                        [adSet.id]: e.target.value,
                                      }))
                                    }
                                    disabled={isSubmitting}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor={`adset-end-${adSet.id}`}>
                                    Término
                                  </Label>
                                  <Input
                                    id={`adset-end-${adSet.id}`}
                                    type="datetime-local"
                                    value={adSetEndTimes[adSet.id] ?? ""}
                                    onChange={(e) =>
                                      setAdSetEndTimes((prev) => ({
                                        ...prev,
                                        [adSet.id]: e.target.value,
                                      }))
                                    }
                                    disabled={isSubmitting}
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {!adSets.length && !isLoadingAdSets && (
                      <p className="text-sm text-muted-foreground">
                        Nenhum conjunto de anúncios encontrado.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="campaignEditNote">
                Nota Explicativa <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="campaignEditNote"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Explique o motivo desta alteração..."
                className="min-h-[90px]"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Salvar Alterações
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
