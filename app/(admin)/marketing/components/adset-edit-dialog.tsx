"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, Facebook, Instagram, Loader2 } from "lucide-react";
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
import type { AdSet, AdSetTargeting } from "@/lib/meta-business/types";
import {
  getBudgetType,
  metaDateToDateTimeLocal,
  minorUnitsToCurrencyInput,
} from "@/lib/meta-business/budget-schedule";
import {
  ALL_PLACEMENTS,
  FACEBOOK_PLACEMENTS,
  INSTAGRAM_PLACEMENTS,
  targetingFieldsToPlacements,
  type PlacementKey,
} from "@/lib/meta-business/placements";
import { cn } from "@/lib/utils";
import { formatCurrency } from "../utils/formatters";
import {
  AudienceMultiSelect,
  type AudienceOption,
} from "./audience-multi-select";
import { LocationTargetingSection } from "./location-targeting-section";
import {
  DEFAULT_BRAZIL_LOCATION,
  buildGeoLocationsPayload,
  type SelectedGeoLocation,
} from "@/lib/meta-business/geo-targeting-types";

const PLACEMENT_LABEL_PT: Record<PlacementKey, string> = {
  facebook_feed: "Feed do Facebook",
  facebook_stories: "Stories do Facebook",
  facebook_reels: "Reels do Facebook",
  instagram_feed: "Feed do Instagram",
  instagram_stories: "Stories do Instagram",
  instagram_reels: "Reels do Instagram",
};

function sortedPlacementsKey(placements: readonly PlacementKey[]): string {
  return [...placements].sort().join(",");
}

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

function geoLocationsToSelectedLocations(
  geo: AdSetTargeting["geo_locations"] | undefined,
): SelectedGeoLocation[] {
  if (!geo) return [DEFAULT_BRAZIL_LOCATION];

  const locations: SelectedGeoLocation[] = [];

  for (const code of geo.countries ?? []) {
    locations.push({
      key: code,
      name: code,
      type: "country",
      country_code: code,
    });
  }
  for (const region of geo.regions ?? []) {
    locations.push({
      key: region.key,
      name: region.name ?? region.key,
      type: "region",
    });
  }
  for (const city of geo.cities ?? []) {
    locations.push({
      key: city.key,
      name: city.name ?? city.key,
      type: "city",
      region: city.region,
    });
  }

  return locations.length > 0 ? locations : [DEFAULT_BRAZIL_LOCATION];
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
  const hasCampaignBudget = Boolean(
    adSet.campaign?.dailyBudget || adSet.campaign?.lifetimeBudget,
  );
  const effectiveBudgetSource = hasCampaignBudget ? adSet.campaign! : adSet;
  const effectiveBudgetType = getBudgetType(effectiveBudgetSource);
  const currentBudgetBRL = effectiveBudgetSource.dailyBudget
    ? Number.parseInt(effectiveBudgetSource.dailyBudget) / 100
    : 0;
  const currentLifetimeBudgetBRL = effectiveBudgetSource.lifetimeBudget
    ? Number.parseInt(effectiveBudgetSource.lifetimeBudget) / 100
    : 0;
  const canEditBudget = !hasCampaignBudget;
  const canEditSchedule = effectiveBudgetType === "lifetime";
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
  const currentPlacements: PlacementKey[] = targetingFieldsToPlacements(
    adSet.targeting,
  );
  // If the ad set is currently Instagram-only (publisher_platforms === ["instagram"]),
  // keep the editor IG-only. Don't promote an IG-only ad set to Facebook by edit.
  const currentPublisherPlatforms = adSet.targeting?.publisher_platforms ?? [];
  const isInstagramOnlyAdSet =
    currentPublisherPlatforms.length === 1 &&
    currentPublisherPlatforms[0] === "instagram";
  const availablePlacementsForAdSet: readonly PlacementKey[] =
    isInstagramOnlyAdSet ? INSTAGRAM_PLACEMENTS : ALL_PLACEMENTS;
  const placementsEditable = currentPlacements.length > 0;

  const [dailyBudget, setDailyBudget] = useState<string>(
    currentBudgetBRL.toFixed(2),
  );
  const [lifetimeBudget, setLifetimeBudget] = useState<string>(
    currentLifetimeBudgetBRL.toFixed(2),
  );
  const [startDateTime, setStartDateTime] = useState<string>(
    metaDateToDateTimeLocal(adSet.startTime),
  );
  const [endDateTime, setEndDateTime] = useState<string>(
    metaDateToDateTimeLocal(adSet.endTime),
  );
  const [ageMin, setAgeMin] = useState<string>(currentAgeMin.toString());
  const [ageMax, setAgeMax] = useState<string>(currentAgeMax.toString());
  const [gender, setGender] = useState<string>(() =>
    getGenderValue(adSet.targeting?.genders),
  );
  const [includedAudiences, setIncludedAudiences] = useState<AudienceOption[]>(
    currentCustomAudiences,
  );
  const [excludedAudiences, setExcludedAudiences] = useState<AudienceOption[]>(
    currentExcludedAudiences,
  );
  const [availableAudiences, setAvailableAudiences] = useState<
    AudienceOption[]
  >([]);
  const [isLoadingAudiences, setIsLoadingAudiences] = useState(false);
  const [selectedLocations, setSelectedLocations] = useState<
    SelectedGeoLocation[]
  >(() => geoLocationsToSelectedLocations(adSet.targeting?.geo_locations));
  const [selectedPlacements, setSelectedPlacements] =
    useState<PlacementKey[]>(currentPlacements);
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

    const budgetSource =
      adSet.campaign?.dailyBudget || adSet.campaign?.lifetimeBudget
        ? adSet.campaign
        : adSet;
    const min = adSet.targeting?.age_min ?? 18;
    const max = adSet.targeting?.age_max ?? 65;
    const included: AudienceOption[] = (
      adSet.targeting?.custom_audiences ?? []
    ).map((a) => ({ id: a.id, name: a.name ?? a.id }));
    const excluded: AudienceOption[] = (
      adSet.targeting?.excluded_custom_audiences ?? []
    ).map((a) => ({ id: a.id, name: a.name ?? a.id }));

    setDailyBudget(minorUnitsToCurrencyInput(budgetSource.dailyBudget));
    setLifetimeBudget(minorUnitsToCurrencyInput(budgetSource.lifetimeBudget));
    setStartDateTime(metaDateToDateTimeLocal(adSet.startTime));
    setEndDateTime(metaDateToDateTimeLocal(adSet.endTime));
    setAgeMin(min.toString());
    setAgeMax(max.toString());
    setGender(getGenderValue(adSet.targeting?.genders));
    setIncludedAudiences(included);
    setExcludedAudiences(excluded);
    setSelectedLocations(
      geoLocationsToSelectedLocations(adSet.targeting?.geo_locations),
    );
    setSelectedPlacements(targetingFieldsToPlacements(adSet.targeting));
    setNote("");
    setError(null);
  }, [adSet, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!note.trim()) {
      setError("A nota explicativa é obrigatória");
      return;
    }

    const budgetValue = Number.parseFloat(dailyBudget);
    const lifetimeBudgetValue = Number.parseFloat(lifetimeBudget);
    const ageMinValue = Number.parseInt(ageMin);
    const ageMaxValue = Number.parseInt(ageMax);

    const hasDailyBudgetChange =
      canEditBudget &&
      effectiveBudgetType === "daily" &&
      !Number.isNaN(budgetValue) &&
      budgetValue !== currentBudgetBRL;
    const hasLifetimeBudgetChange =
      canEditBudget &&
      effectiveBudgetType === "lifetime" &&
      !Number.isNaN(lifetimeBudgetValue) &&
      lifetimeBudgetValue !== currentLifetimeBudgetBRL;
    const hasScheduleChange =
      canEditSchedule &&
      (metaDateToDateTimeLocal(adSet.startTime) !== startDateTime ||
        metaDateToDateTimeLocal(adSet.endTime) !== endDateTime);
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

    const geoLocationsPayload = buildGeoLocationsPayload(selectedLocations);
    const hasGeoLocationChange =
      JSON.stringify(geoLocationsPayload) !==
      JSON.stringify(
        buildGeoLocationsPayload(
          geoLocationsToSelectedLocations(adSet.targeting?.geo_locations),
        ),
      );

    const hasPlacementsChange =
      placementsEditable &&
      sortedPlacementsKey(selectedPlacements) !==
        sortedPlacementsKey(currentPlacements);

    const hasTargetingChange =
      hasAgeMinChange ||
      hasAgeMaxChange ||
      hasGenderChange ||
      hasIncludedAudienceChange ||
      hasExcludedAudienceChange ||
      hasGeoLocationChange ||
      hasPlacementsChange;

    if (
      !hasDailyBudgetChange &&
      !hasLifetimeBudgetChange &&
      !hasScheduleChange &&
      !hasTargetingChange
    ) {
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

    if (hasPlacementsChange && selectedPlacements.length === 0) {
      setError("Selecione pelo menos um posicionamento");
      return;
    }

    if (hasDailyBudgetChange && budgetValue < 1) {
      setError("Orçamento diário deve ser pelo menos R$ 1,00");
      return;
    }

    if (hasLifetimeBudgetChange && lifetimeBudgetValue < 1) {
      setError("Orçamento total deve ser pelo menos R$ 1,00");
      return;
    }

    if (
      hasScheduleChange &&
      (!startDateTime ||
        !endDateTime ||
        new Date(endDateTime) <= new Date(startDateTime))
    ) {
      setError(
        "Informe início e término válidos. O término deve ser posterior ao início.",
      );
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

      if (hasDailyBudgetChange) {
        body.dailyBudget = budgetValue;
      }
      if (hasLifetimeBudgetChange) {
        body.lifetimeBudget = lifetimeBudgetValue;
      }
      if (hasScheduleChange) {
        body.startTime = startDateTime;
        body.endTime = endDateTime;
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
          ...(hasGeoLocationChange &&
            geoLocationsPayload && {
              geo_locations: geoLocationsPayload,
            }),
          ...(hasPlacementsChange && { placements: selectedPlacements }),
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
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message ?? "Falha ao aplicar alterações");
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erro ao aplicar alterações",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setDailyBudget(currentBudgetBRL.toFixed(2));
      setLifetimeBudget(currentLifetimeBudgetBRL.toFixed(2));
      setStartDateTime(metaDateToDateTimeLocal(adSet.startTime));
      setEndDateTime(metaDateToDateTimeLocal(adSet.endTime));
      setAgeMin(currentAgeMin.toString());
      setAgeMax(currentAgeMax.toString());
      setGender(getGenderValue(adSet.targeting?.genders));
      setIncludedAudiences(currentCustomAudiences);
      setExcludedAudiences(currentExcludedAudiences);
      setSelectedLocations(
        geoLocationsToSelectedLocations(adSet.targeting?.geo_locations),
      );
      setSelectedPlacements(currentPlacements);
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
            Altere orçamento, período e/ou segmentação do público. Todas as
            alterações são registradas para auditoria.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>
                {effectiveBudgetType === "lifetime"
                  ? "Orçamento Total"
                  : "Orçamento Diário"}
              </Label>
              {!canEditBudget ? (
                <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  Esta campanha utiliza Orçamento de Campanha (CBO). O orçamento
                  é controlado no nível da campanha.
                </div>
              ) : effectiveBudgetType === "daily" ? (
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
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    id="lifetimeBudget"
                    type="number"
                    step="0.01"
                    min="1"
                    value={lifetimeBudget}
                    onChange={(e) => setLifetimeBudget(e.target.value)}
                    placeholder="Ex: 500.00"
                    disabled={isSubmitting}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    Atual: {formatCurrency(currentLifetimeBudgetBRL)}
                  </span>
                </div>
              )}
            </div>

            {canEditSchedule && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="startDateTime">Início</Label>
                  <Input
                    id="startDateTime"
                    type="datetime-local"
                    value={startDateTime}
                    onChange={(e) => setStartDateTime(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDateTime">Término</Label>
                  <Input
                    id="endDateTime"
                    type="datetime-local"
                    value={endDateTime}
                    onChange={(e) => setEndDateTime(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            )}

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
                {(
                  [
                    { value: "all", label: "Todos" },
                    { value: "male", label: "Masculino" },
                    { value: "female", label: "Feminino" },
                  ] as const
                ).map((option) => (
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

            <LocationTargetingSection
              accountId={accountId}
              userId={userId}
              selectedLocations={selectedLocations}
              onLocationsChange={setSelectedLocations}
              disabled={isSubmitting}
            />

            <div className="space-y-2">
              <Label>Posicionamentos</Label>
              {!placementsEditable ? (
                <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  Este conjunto de anúncios usa posicionamentos automáticos do
                  Meta (Advantage+). Para alterar, use o Gerenciador de Anúncios.
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {availablePlacementsForAdSet.map((key) => {
                    const checked = selectedPlacements.includes(key);
                    const isFb = (FACEBOOK_PLACEMENTS as readonly string[]).includes(
                      key,
                    );
                    const PlatformIcon = isFb ? Facebook : Instagram;
                    const toggle = () => {
                      if (isSubmitting) return;
                      setSelectedPlacements((prev) => {
                        const set = new Set(prev);
                        if (set.has(key)) set.delete(key);
                        else set.add(key);
                        return ALL_PLACEMENTS.filter((p) => set.has(p));
                      });
                    };
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={toggle}
                        disabled={isSubmitting}
                        className={cn(
                          "flex items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50",
                          checked && "border-primary/60 bg-primary/5",
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-4 place-content-center rounded-sm border border-primary",
                            checked
                              ? "bg-primary text-primary-foreground"
                              : "bg-background",
                          )}
                        >
                          {checked ? <Check className="size-3" /> : null}
                        </span>
                        <PlatformIcon className="size-4 text-muted-foreground" />
                        <span>{PLACEMENT_LABEL_PT[key]}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {placementsEditable && currentPlacements.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Atual:{" "}
                  {currentPlacements
                    .map((k) => PLACEMENT_LABEL_PT[k])
                    .join(", ")}
                </p>
              ) : null}
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
