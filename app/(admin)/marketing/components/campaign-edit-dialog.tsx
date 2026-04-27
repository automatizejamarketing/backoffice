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

function toBudgetInput(minorUnits?: string): string {
  if (!minorUnits) return "";
  const value = Number.parseInt(minorUnits, 10);
  if (Number.isNaN(value)) return "";
  return (value / 100).toFixed(2);
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

  const [selectedMode, setSelectedMode] = useState<CampaignBudgetMode>(
    campaign.budgetMode,
  );
  const [dailyBudget, setDailyBudget] = useState<string>(
    toBudgetInput(campaign.dailyBudget),
  );
  const [note, setNote] = useState("");
  const [adSets, setAdSets] = useState<AdSet[]>([]);
  const [adSetBudgetValues, setAdSetBudgetValues] = useState<
    Record<string, string>
  >({});
  const [isLoadingAdSets, setIsLoadingAdSets] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shouldLoadAdSets = isOpen && selectedMode === "ABO";
  const isModeChanged = selectedMode !== campaign.budgetMode;
  const isCboBudgetChanged =
    selectedMode === "CBO" &&
    currentDailyBudgetValue !== Number.parseFloat(dailyBudget || "NaN");

  const fetchAdSets = useCallback(async () => {
    if (!shouldLoadAdSets) return;

    setIsLoadingAdSets(true);
    try {
      const params = new URLSearchParams({
        userId,
        campaignId: campaign.id,
        limit: "100",
      });
      const response = await fetch(`/api/meta-marketing/${accountId}/adsets?${params}`);

      if (!response.ok) {
        throw new Error("Falha ao carregar os conjuntos de anúncios");
      }

      const data: GetAdSetsResponse = await response.json();
      const nextAdSets = data.data ?? [];
      setAdSets(nextAdSets);
      setAdSetBudgetValues((prev) => {
        const nextValues: Record<string, string> = {};
        for (const adSet of nextAdSets) {
          nextValues[adSet.id] = prev[adSet.id] ?? toBudgetInput(adSet.dailyBudget);
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
  }, [accountId, campaign.id, shouldLoadAdSets, userId]);

  useEffect(() => {
    if (!isOpen) return;

    setSelectedMode(campaign.budgetMode);
    setDailyBudget(toBudgetInput(campaign.dailyBudget));
    setNote("");
    setError(null);
    setAdSets([]);
    setAdSetBudgetValues({});
  }, [campaign.budgetMode, campaign.dailyBudget, campaign.id, isOpen]);

  useEffect(() => {
    if (!shouldLoadAdSets) return;
    void fetchAdSets();
  }, [fetchAdSets, shouldLoadAdSets]);

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

    if (!isModeChanged && !isCboBudgetChanged) {
      setError("Nenhuma alteração foi feita");
      return;
    }

    const body: Record<string, unknown> = {
      campaignId: campaign.id,
      campaignName: campaign.name,
      mode: selectedMode,
      note: note.trim(),
    };

    if (selectedMode === "CBO") {
      const budgetValue = Number.parseFloat(dailyBudget);
      if (Number.isNaN(budgetValue) || budgetValue < 1) {
        setError("Informe um orçamento diário válido de pelo menos R$ 1,00");
        return;
      }

      body.dailyBudget = budgetValue;
    } else {
      if (campaign.budgetMode === "ABO") {
        setError(
          "Esta campanha já utiliza ABO. Para alterar orçamento, edite os conjuntos individualmente.",
        );
        return;
      }

      if (!adSets.length) {
        setError(
          "Nenhum conjunto de anúncios foi encontrado para configurar a mudança para ABO.",
        );
        return;
      }

      const adsetBudgets: CampaignAdSetBudgetInput[] = [];

      for (const adSet of adSets) {
        const rawValue = adSetBudgetValues[adSet.id];
        const parsedValue = Number.parseFloat(rawValue);

        if (Number.isNaN(parsedValue) || parsedValue < 1) {
          setError(
            `Defina um orçamento diário válido para o conjunto "${adSet.name ?? adSet.id}".`,
          );
          return;
        }

        adsetBudgets.push({
          adsetId: adSet.id,
          adsetName: adSet.name,
          dailyBudget: parsedValue,
        });
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
        throw new Error("A campanha foi salva, mas a resposta retornou incompleta.");
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
                {([
                  {
                    value: "ABO" as const,
                    label: "ABO",
                    description: "Orçamento definido por conjunto de anúncios.",
                  },
                  {
                    value: "CBO" as const,
                    label: "CBO",
                    description: "Orçamento diário definido no nível da campanha.",
                  },
                ] as const).map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={selectedMode === option.value ? "default" : "outline"}
                    className="h-auto flex-col items-start gap-1 p-4 text-left"
                    disabled={isSubmitting}
                    onClick={() => setSelectedMode(option.value)}
                  >
                    <span className="text-sm font-semibold">{option.label}</span>
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

            {selectedMode === "CBO" ? (
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
                <p className="text-xs text-muted-foreground">
                  Quando CBO está ativo, a Meta distribui o orçamento entre os
                  conjuntos da campanha.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  Para desativar CBO, a Meta exige um orçamento diário individual
                  para cada conjunto de anúncios da campanha.
                </div>

                {isLoadingAdSets ? (
                  <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Carregando conjuntos de anúncios...
                  </div>
                ) : (
                  <div className="space-y-3">
                    {adSets.map((adSet) => (
                      <div
                        key={adSet.id}
                        className="rounded-lg border border-border p-3 space-y-2"
                      >
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-medium text-sm">
                              {adSet.name ?? adSet.id}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Atual:{" "}
                              {adSet.dailyBudget
                                ? formatCurrency(
                                    Number.parseInt(adSet.dailyBudget, 10) / 100,
                                  )
                                : "sem orçamento individual"}
                            </p>
                          </div>
                        </div>
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
                      </div>
                    ))}

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
