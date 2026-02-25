"use client";

import { useState } from "react";
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

type AdSetEditDialogProps = {
  adSet: AdSet;
  accountId: string;
  userId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

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
  const currentCountries = adSet.targeting?.geo_locations?.countries ?? [];
  const currentGenders = adSet.targeting?.genders ?? [];

  const getGenderValue = (genders: number[]) => {
    if (genders.length === 0) return "all";
    if (genders.length === 1 && genders[0] === 1) return "male";
    if (genders.length === 1 && genders[0] === 2) return "female";
    return "all";
  };

  const [dailyBudget, setDailyBudget] = useState<string>(
    currentBudgetBRL.toFixed(2)
  );
  const [ageMin, setAgeMin] = useState<string>(currentAgeMin.toString());
  const [ageMax, setAgeMax] = useState<string>(currentAgeMax.toString());
  const [countries, setCountries] = useState<string>(currentCountries.join(", "));
  const [gender, setGender] = useState<string>(getGenderValue(currentGenders));
  const [note, setNote] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const countriesArray = countries
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter((c) => c.length > 0);

    const hasBudgetChange =
      !usesCBO && !Number.isNaN(budgetValue) && budgetValue !== currentBudgetBRL;
    const hasAgeMinChange =
      !Number.isNaN(ageMinValue) && ageMinValue !== currentAgeMin;
    const hasAgeMaxChange =
      !Number.isNaN(ageMaxValue) && ageMaxValue !== currentAgeMax;
    const hasCountriesChange =
      countriesArray.length > 0 &&
      JSON.stringify(countriesArray) !== JSON.stringify(currentCountries);

    const gendersArray =
      gender === "male" ? [1] : gender === "female" ? [2] : [];
    const hasGenderChange =
      JSON.stringify(gendersArray) !== JSON.stringify(currentGenders);

    const hasTargetingChange =
      hasAgeMinChange || hasAgeMaxChange || hasCountriesChange || hasGenderChange;

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
          ...(hasGenderChange && { genders: gendersArray }),
          ...(hasCountriesChange && {
            geo_locations: { countries: countriesArray },
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
      setCountries(currentCountries.join(", "));
      setGender(getGenderValue(currentGenders));
      setNote("");
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[500px]">
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
                Atual: {currentGenders.length === 0
                  ? "Todos"
                  : currentGenders.includes(1) && currentGenders.length === 1
                    ? "Masculino"
                    : currentGenders.includes(2) && currentGenders.length === 1
                      ? "Feminino"
                      : "Todos"}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="countries">
                Países (códigos ISO separados por vírgula)
              </Label>
              <Input
                id="countries"
                type="text"
                value={countries}
                onChange={(e) => setCountries(e.target.value)}
                placeholder="Ex: BR, US, PT"
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                Atual: {currentCountries.length > 0 ? currentCountries.join(", ") : "Não definido"}
              </p>
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
