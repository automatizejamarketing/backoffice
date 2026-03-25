"use client";

import { useState, useEffect, useCallback } from "react";
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
import type { AdSet } from "@/lib/meta-business/types";
import { formatCurrency } from "../utils/formatters";
import {
  AudienceMultiSelect,
  type AudienceOption,
} from "./audience-multi-select";

type AdSetEditDialogProps = {
  adSet: AdSet;
  accountId: string;
  userId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

/** Meta may return 1/2 as numbers or strings; normalize for comparisons. */
function normalizeGenderCodes(
  genders: readonly unknown[] | undefined,
): number[] {
  if (!genders?.length) return [];
  const out: number[] = [];
  for (const g of genders) {
    const n = typeof g === "string" ? Number.parseInt(g, 10) : Number(g);
    if (n === 1 || n === 2) out.push(n);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function getGenderValue(genders: readonly unknown[] | undefined): string {
  const g = normalizeGenderCodes(genders);
  if (g.length === 0) return "all";
  if (g.length === 1 && g[0] === 1) return "male";
  if (g.length === 1 && g[0] === 2) return "female";
  return "all";
}

export function AdSetEditDialog({
  adSet,
  accountId,
  userId,
  isOpen,
  onClose,
  onSuccess,
}: AdSetEditDialogProps) {
  const currentBudgetBRL = adSet.dailyBudget
    ? Number.parseInt(adSet.dailyBudget) / 100
    : 0;
  const usesCBO = !adSet.dailyBudget;
  const currentAgeMin = adSet.targeting?.age_min ?? 18;
  const currentAgeMax = adSet.targeting?.age_max ?? 65;
  const currentGendersNormalized = normalizeGenderCodes(
    adSet.targeting?.genders,
  );
  const currentCustomAudiences: AudienceOption[] = (
    adSet.targeting?.custom_audiences ?? []
  ).map((a) => ({ id: a.id, name: a.name ?? a.id }));
  const currentExcludedAudiences: AudienceOption[] = (
    adSet.targeting?.excluded_custom_audiences ?? []
  ).map((a) => ({ id: a.id, name: a.name ?? a.id }));

  const [dailyBudget, setDailyBudget] = useState<string>(
    currentBudgetBRL.toFixed(2)
  );
  const [ageMin, setAgeMin] = useState<string>(currentAgeMin.toString());
  const [ageMax, setAgeMax] = useState<string>(currentAgeMax.toString());
  const [gender, setGender] = useState<string>(() =>
    getGenderValue(adSet.targeting?.genders),
  );
  const [includedAudiences, setIncludedAudiences] =
    useState<AudienceOption[]>(currentCustomAudiences);
  const [excludedAudiences, setExcludedAudiences] =
    useState<AudienceOption[]>(currentExcludedAudiences);
  const [availableAudiences, setAvailableAudiences] = useState<
    AudienceOption[]
  >([]);
  const [isLoadingAudiences, setIsLoadingAudiences] = useState(false);
  const [note, setNote] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAudiences = useCallback(async () => {
    setIsLoadingAudiences(true);
    try {
      const response = await fetch(
        `/api/meta-marketing/${accountId}/audiences?userId=${userId}`,
      );
      if (response.ok) {
        const data = await response.json();
        setAvailableAudiences(data.audiences);
      }
    } catch {
      // Silently fail - audiences list is optional
    } finally {
      setIsLoadingAudiences(false);
    }
  }, [accountId, userId]);

  useEffect(() => {
    if (isOpen) {
      fetchAudiences();
    }
  }, [isOpen, fetchAudiences]);

  // Reset form when the dialog opens or when switching to another ad set.
  // Without this, React keeps stale state from a previous ad set, so the user
  // can align the UI with the API and submit with "Nenhuma alteração foi feita".
  useEffect(() => {
    if (!isOpen) return;

    const budget = adSet.dailyBudget
      ? Number.parseInt(adSet.dailyBudget) / 100
      : 0;
    const min = adSet.targeting?.age_min ?? 18;
    const max = adSet.targeting?.age_max ?? 65;
    const included: AudienceOption[] = (
      adSet.targeting?.custom_audiences ?? []
    ).map((a) => ({ id: a.id, name: a.name ?? a.id }));
    const excluded: AudienceOption[] = (
      adSet.targeting?.excluded_custom_audiences ?? []
    ).map((a) => ({ id: a.id, name: a.name ?? a.id }));

    setDailyBudget(budget.toFixed(2));
    setAgeMin(min.toString());
    setAgeMax(max.toString());
    setGender(getGenderValue(adSet.targeting?.genders));
    setIncludedAudiences(included);
    setExcludedAudiences(excluded);
    setNote("");
    setError(null);
  }, [isOpen, adSet.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!note.trim()) {
      setError("A nota explicativa é obrigatória");
      return;
    }

    const budgetValue = Number.parseFloat(dailyBudget);
    const ageMinValue = Number.parseInt(ageMin);
    const ageMaxValue = Number.parseInt(ageMax);

    const hasBudgetChange =
      !usesCBO && !Number.isNaN(budgetValue) && budgetValue !== currentBudgetBRL;
    const hasAgeMinChange =
      !Number.isNaN(ageMinValue) && ageMinValue !== currentAgeMin;
    const hasAgeMaxChange =
      !Number.isNaN(ageMaxValue) && ageMaxValue !== currentAgeMax;

    const gendersArray =
      gender === "male" ? [1] : gender === "female" ? [2] : [];
    const desiredGendersNormalized = normalizeGenderCodes(gendersArray);
    const hasGenderChange =
      JSON.stringify(desiredGendersNormalized) !==
      JSON.stringify(currentGendersNormalized);

    const currentIncludedIds = currentCustomAudiences
      .map((a) => a.id)
      .sort()
      .join(",");
    const newIncludedIds = includedAudiences
      .map((a) => a.id)
      .sort()
      .join(",");
    const hasIncludedAudienceChange = currentIncludedIds !== newIncludedIds;

    const currentExcludedIds = currentExcludedAudiences
      .map((a) => a.id)
      .sort()
      .join(",");
    const newExcludedIds = excludedAudiences
      .map((a) => a.id)
      .sort()
      .join(",");
    const hasExcludedAudienceChange = currentExcludedIds !== newExcludedIds;

    const hasTargetingChange =
      hasAgeMinChange ||
      hasAgeMaxChange ||
      hasGenderChange ||
      hasIncludedAudienceChange ||
      hasExcludedAudienceChange;

    if (!hasBudgetChange && !hasTargetingChange) {
      setError("Nenhuma alteração foi feita");
      return;
    }

    if (ageMinValue < 13 || ageMinValue > 65) {
      setError("Idade mínima deve estar entre 13 e 65");
      return;
    }

    if (ageMaxValue < 13 || ageMaxValue > 65) {
      setError("Idade máxima deve estar entre 13 e 65");
      return;
    }

    if (ageMinValue > ageMaxValue) {
      setError("Idade mínima não pode ser maior que a idade máxima");
      return;
    }

    if (hasBudgetChange && budgetValue < 1) {
      setError("Orçamento diário deve ser pelo menos R$ 1,00");
      return;
    }

    setIsSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        userId,
        campaignId: adSet.campaignId,
        adsetName: adSet.name,
        note: note.trim(),
      };

      if (hasBudgetChange) {
        body.dailyBudget = budgetValue;
      }

      if (hasTargetingChange) {
        body.targeting = {
          ...(hasAgeMinChange && { age_min: ageMinValue }),
          ...(hasAgeMaxChange && { age_max: ageMaxValue }),
          ...(hasGenderChange && { genders: desiredGendersNormalized }),
          ...(hasIncludedAudienceChange && {
            custom_audiences: includedAudiences.map((a) => ({
              id: a.id,
              name: a.name,
            })),
          }),
          ...(hasExcludedAudienceChange && {
            excluded_custom_audiences: excludedAudiences.map((a) => ({
              id: a.id,
              name: a.name,
            })),
          }),
        };
      }

      const response = await fetch(
        `/api/meta-marketing/${accountId}/adsets/${adSet.id}/edit`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message ?? "Falha ao aplicar alterações");
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erro ao aplicar alterações"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setDailyBudget(currentBudgetBRL.toFixed(2));
      setAgeMin(currentAgeMin.toString());
      setAgeMax(currentAgeMax.toString());
      setGender(getGenderValue(adSet.targeting?.genders));
      setIncludedAudiences(currentCustomAudiences);
      setExcludedAudiences(currentExcludedAudiences);
      setNote("");
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Conjunto de Anúncios</DialogTitle>
          <DialogDescription>
            Altere o orçamento diário e/ou segmentação do público. Todas as
            alterações são registradas para auditoria.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dailyBudget">Orçamento Diário (R$)</Label>
              {usesCBO ? (
                <p className="text-xs text-muted-foreground rounded-md bg-muted p-3">
                  Esta campanha utiliza Orçamento de Campanha (CBO). O orçamento
                  diário é controlado no nível da campanha e não pode ser
                  alterado aqui.
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    id="dailyBudget"
                    type="number"
                    step="0.01"
                    min="1"
                    value={dailyBudget}
                    onChange={(e) => setDailyBudget(e.target.value)}
                    placeholder="Ex: 50.00"
                    disabled={isSubmitting}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    Atual: {formatCurrency(currentBudgetBRL)}
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ageMin">Idade Mínima</Label>
                <Input
                  id="ageMin"
                  type="number"
                  min="13"
                  max="65"
                  value={ageMin}
                  onChange={(e) => setAgeMin(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ageMax">Idade Máxima</Label>
                <Input
                  id="ageMax"
                  type="number"
                  min="13"
                  max="65"
                  value={ageMax}
                  onChange={(e) => setAgeMax(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Gênero</Label>
              <div className="flex gap-2">
                {([
                  { value: "all", label: "Todos" },
                  { value: "male", label: "Masculino" },
                  { value: "female", label: "Feminino" },
                ] as const).map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    size="sm"
                    variant={gender === option.value ? "default" : "outline"}
                    onClick={() => setGender(option.value)}
                    disabled={isSubmitting}
                    className="flex-1"
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Atual:{" "}
                {currentGendersNormalized.length === 0
                  ? "Todos"
                  : currentGendersNormalized.length === 1 &&
                      currentGendersNormalized[0] === 1
                    ? "Masculino"
                    : currentGendersNormalized.length === 1 &&
                        currentGendersNormalized[0] === 2
                      ? "Feminino"
                      : "Todos"}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Incluir Públicos</Label>
              <AudienceMultiSelect
                label="Selecionar públicos para incluir..."
                placeholder="Buscar público..."
                audiences={availableAudiences}
                selected={includedAudiences}
                onChange={setIncludedAudiences}
                disabled={isSubmitting}
                isLoading={isLoadingAudiences}
              />
            </div>

            <div className="space-y-2">
              <Label>Excluir Públicos</Label>
              <AudienceMultiSelect
                label="Selecionar públicos para excluir..."
                placeholder="Buscar público..."
                audiences={availableAudiences}
                selected={excludedAudiences}
                onChange={setExcludedAudiences}
                disabled={isSubmitting}
                isLoading={isLoadingAudiences}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">
                Nota Explicativa <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Explique o motivo desta alteração..."
                disabled={isSubmitting}
                className="min-h-[80px]"
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
              Aplicar Alterações
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
