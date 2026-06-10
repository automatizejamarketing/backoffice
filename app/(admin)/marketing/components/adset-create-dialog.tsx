"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import { Check, Facebook, ImageIcon, Info, Instagram, Loader2, X } from "lucide-react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AudienceMultiSelect,
  type AudienceOption,
} from "./audience-multi-select";
import {
  InstagramPostPicker,
  type InstagramMediaItem,
} from "./instagram-post-picker";
import { useMarketingInvalidate } from "../hooks/marketing-queries";
import { InterestTargetingSection } from "./interest-targeting-section";
import { LocationTargetingSection } from "./location-targeting-section";
import { PageSelector } from "./page-selector";
import { usePages } from "./use-pages";
import {
  AdSetDeliveryScheduleEditor,
  type AdSetDeliveryScheduleValue,
} from "./adset-delivery-schedule-editor";
import {
  DEFAULT_BRAZIL_LOCATION,
  buildGeoLocationsPayload,
  type SelectedGeoLocation,
} from "@/lib/meta-business/geo-targeting-types";
import {
  createDefaultInterestTargetingValue,
  hasInterestTargetingConfigured,
  type InterestTargetingValue,
} from "@/lib/meta-business/interest-targeting-types";
import {
  dateTimeLocalToMeta,
  getBudgetType,
  hasMinimumRuntime,
  isEndAfterStart,
  isEndInFuture,
  isValidDateTimeLocal,
  type BudgetType,
} from "@/lib/meta-business/budget-schedule";
import { validateCampaignSchedulePayload } from "@/lib/meta-business/campaign-schedule";
import {
  ALL_PLACEMENTS,
  DEFAULT_PLACEMENTS_BY_CAMPAIGN_TYPE,
  FACEBOOK_PLACEMENTS,
  INSTAGRAM_PLACEMENTS,
  type PlacementKey,
} from "@/lib/meta-business/placements";
import { cn } from "@/lib/utils";

const MAX_MEDIA_ITEMS = 5;

const SALES_OBJECTIVES = ["OUTCOME_SALES", "CONVERSIONS"];
const LEADS_OBJECTIVES = ["OUTCOME_LEADS", "LEAD_GENERATION"];
const TRAFFIC_OBJECTIVES = ["OUTCOME_TRAFFIC", "LINK_CLICKS"];

const PLACEMENT_LABEL_PT: Record<PlacementKey, string> = {
  facebook_feed: "Feed do Facebook",
  facebook_stories: "Stories do Facebook",
  facebook_reels: "Reels do Facebook",
  instagram_feed: "Feed do Instagram",
  instagram_stories: "Stories do Instagram",
  instagram_reels: "Reels do Instagram",
};

type PixelOption = { id: string; name?: string };

type AdSetCreateDialogProps = {
  campaignId: string;
  campaignName?: string;
  campaignObjective?: string;
  usesCampaignBudget?: boolean;
  campaignDailyBudget?: string;
  campaignLifetimeBudget?: string;
  accountId: string;
  userId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

function getDefaultPlacements(objective?: string): PlacementKey[] {
  if (TRAFFIC_OBJECTIVES.includes(objective ?? "")) {
    return [...DEFAULT_PLACEMENTS_BY_CAMPAIGN_TYPE.traffic];
  }
  if (SALES_OBJECTIVES.includes(objective ?? "")) {
    return [...DEFAULT_PLACEMENTS_BY_CAMPAIGN_TYPE.sales];
  }
  return [...DEFAULT_PLACEMENTS_BY_CAMPAIGN_TYPE.leads];
}

function createInitialDeliverySchedule(): AdSetDeliveryScheduleValue {
  return { deliveryMode: "all_day", scheduleBlocks: [] };
}

export function AdSetCreateDialog({
  campaignId,
  campaignName,
  campaignObjective,
  usesCampaignBudget = false,
  campaignDailyBudget,
  campaignLifetimeBudget,
  accountId,
  userId,
  isOpen,
  onClose,
  onSuccess,
}: AdSetCreateDialogProps) {
  const invalidateMarketing = useMarketingInvalidate(accountId, userId);
  const [adsetName, setAdsetName] = useState("");
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [budgetType, setBudgetType] = useState<BudgetType>("daily");
  const [budgetValue, setBudgetValue] = useState("15.00");
  const [startDateTime, setStartDateTime] = useState("");
  const [endDateTime, setEndDateTime] = useState("");
  const [deliverySchedule, setDeliverySchedule] =
    useState<AdSetDeliveryScheduleValue>(createInitialDeliverySchedule);
  const [selectedPixelId, setSelectedPixelId] = useState<string | null>(null);
  const [pixels, setPixels] = useState<PixelOption[]>([]);
  const [isLoadingPixels, setIsLoadingPixels] = useState(false);
  const [selectedPlacements, setSelectedPlacements] = useState<PlacementKey[]>(
    () => getDefaultPlacements(campaignObjective),
  );
  const [ageMin, setAgeMin] = useState("18");
  const [ageMax, setAgeMax] = useState("65");
  const [gender, setGender] = useState<"all" | "male" | "female">("all");
  const [includedAudiences, setIncludedAudiences] = useState<AudienceOption[]>(
    [],
  );
  const [excludedAudiences, setExcludedAudiences] = useState<AudienceOption[]>(
    [],
  );
  const [availableAudiences, setAvailableAudiences] = useState<
    AudienceOption[]
  >([]);
  const [isLoadingAudiences, setIsLoadingAudiences] = useState(false);
  const [selectedPosts, setSelectedPosts] = useState<InstagramMediaItem[]>([]);
  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [selectedLocations, setSelectedLocations] = useState<SelectedGeoLocation[]>([
    DEFAULT_BRAZIL_LOCATION,
  ]);
  const [interestTargeting, setInterestTargeting] =
    useState<InterestTargetingValue>(createDefaultInterestTargetingValue);

  const { pages, isLoading: isLoadingPages } = usePages(
    accountId,
    userId,
    isOpen,
  );
  const selectedPage =
    pages.find((page) => page.pageId === selectedPageId) ?? null;
  const selectedInstagramAccountId =
    selectedPage?.instagramBusinessAccountId ?? undefined;

  const isSalesCampaign = SALES_OBJECTIVES.includes(campaignObjective ?? "");
  const isLeadsCampaign = LEADS_OBJECTIVES.includes(campaignObjective ?? "");
  const isTrafficCampaign = TRAFFIC_OBJECTIVES.includes(
    campaignObjective ?? "",
  );
  const isInstagramOnly = isTrafficCampaign;
  const availablePlacements = isInstagramOnly
    ? INSTAGRAM_PLACEMENTS
    : ALL_PLACEMENTS;

  const canEditDeliverySchedule = useMemo(() => {
    if (usesCampaignBudget) {
      return (
        getBudgetType({
          dailyBudget: campaignDailyBudget,
          lifetimeBudget: campaignLifetimeBudget,
        }) === "lifetime"
      );
    }
    return budgetType === "lifetime";
  }, [
    usesCampaignBudget,
    campaignDailyBudget,
    campaignLifetimeBudget,
    budgetType,
  ]);

  const hasPosts = selectedPosts.length > 0;

  const fetchAudiences = useCallback(async () => {
    setIsLoadingAudiences(true);
    try {
      const response = await fetch(
        `/api/meta-marketing/${accountId}/audiences?userId=${userId}`,
      );
      if (response.ok) {
        const data = await response.json();
        setAvailableAudiences(data.audiences ?? []);
      }
    } catch {
      // optional
    } finally {
      setIsLoadingAudiences(false);
    }
  }, [accountId, userId]);

  const fetchPixels = useCallback(async () => {
    if (!isSalesCampaign) return;
    setIsLoadingPixels(true);
    try {
      const response = await fetch(
        `/api/meta-marketing/${accountId}/pixels?userId=${userId}`,
      );
      if (response.ok) {
        const data = await response.json();
        const list: PixelOption[] = data.data ?? [];
        setPixels(list);
        if (list.length > 0) {
          setSelectedPixelId((current) => current ?? list[0].id);
        }
      }
    } catch {
      // optional
    } finally {
      setIsLoadingPixels(false);
    }
  }, [accountId, userId, isSalesCampaign]);

  const resetForm = useCallback(() => {
    setAdsetName("");
    setSelectedPageId(null);
    setBudgetType("daily");
    setBudgetValue("15.00");
    setStartDateTime("");
    setEndDateTime("");
    setDeliverySchedule(createInitialDeliverySchedule());
    setSelectedPixelId(null);
    setPixels([]);
    setSelectedPlacements(getDefaultPlacements(campaignObjective));
    setAgeMin("18");
    setAgeMax("65");
    setGender("all");
    setIncludedAudiences([]);
    setExcludedAudiences([]);
    setSelectedPosts([]);
    setError(null);
    setUrl("");
    setSelectedLocations([DEFAULT_BRAZIL_LOCATION]);
    setInterestTargeting(createDefaultInterestTargetingValue());
  }, [campaignObjective]);

  useEffect(() => {
    if (isOpen) {
      resetForm();
      fetchAudiences();
      void fetchPixels();
    }
  }, [isOpen, resetForm, fetchAudiences, fetchPixels]);

  useEffect(() => {
    if (!isOpen || isLoadingPages || pages.length === 0 || selectedPageId) {
      return;
    }
    setSelectedPageId(pages[0].pageId);
  }, [isOpen, isLoadingPages, pages, selectedPageId]);

  useEffect(() => {
    setSelectedPosts([]);
  }, [selectedInstagramAccountId]);

  const handleClose = () => {
    if (!isSubmitting) {
      resetForm();
      onClose();
    }
  };

  const removePost = (postId: string) => {
    setSelectedPosts((prev) => prev.filter((p) => p.id !== postId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedBudget = Number.parseFloat(budgetValue);
    const ageMinValue = Number.parseInt(ageMin);
    const ageMaxValue = Number.parseInt(ageMax);

    if (!adsetName.trim()) {
      setError("Informe um nome para o conjunto.");
      return;
    }

    if (!usesCampaignBudget) {
      if (Number.isNaN(parsedBudget) || parsedBudget < 1) {
        setError("Informe um orçamento válido de pelo menos R$ 1,00.");
        return;
      }

      if (budgetType === "lifetime") {
        if (!isValidDateTimeLocal(startDateTime) || !isValidDateTimeLocal(endDateTime)) {
          setError("Orçamento total exige data de início e término.");
          return;
        }
        const startIso = dateTimeLocalToMeta(startDateTime);
        const endIso = dateTimeLocalToMeta(endDateTime);
        if (!isEndAfterStart(startIso, endIso)) {
          setError("A data de término deve ser posterior à de início.");
          return;
        }
        if (!hasMinimumRuntime(startIso, endIso)) {
          setError("O período deve ter pelo menos 1 hora de duração.");
          return;
        }
        if (!isEndInFuture(endIso)) {
          setError("A data de término deve estar no futuro.");
          return;
        }
      }
    }

    if (selectedPlacements.length === 0) {
      setError("Selecione ao menos um posicionamento.");
      return;
    }

    if (isSalesCampaign && !selectedPixelId) {
      setError("Selecione um Pixel Meta para campanhas de vendas.");
      return;
    }

    if (Number.isNaN(ageMinValue) || ageMinValue < 13 || ageMinValue > 65) {
      setError("Idade mínima deve estar entre 13 e 65");
      return;
    }

    if (Number.isNaN(ageMaxValue) || ageMaxValue < 13 || ageMaxValue > 65) {
      setError("Idade máxima deve estar entre 13 e 65");
      return;
    }

    if (ageMinValue > ageMaxValue) {
      setError("Idade mínima não pode ser maior que a idade máxima");
      return;
    }

    if (canEditDeliverySchedule && deliverySchedule.deliveryMode === "specific_hours") {
      const scheduleError = validateCampaignSchedulePayload({
        startTime: usesCampaignBudget ? "" : dateTimeLocalToMeta(startDateTime),
        endTime: usesCampaignBudget ? "" : dateTimeLocalToMeta(endDateTime),
        deliveryMode: deliverySchedule.deliveryMode,
        scheduleBlocks: deliverySchedule.scheduleBlocks,
      });
      if (scheduleError) {
        setError(scheduleError);
        return;
      }
    }

    if (isSalesCampaign && hasPosts && !url.trim()) {
      setError(
        "Campanhas de vendas requerem uma URL de destino para o anúncio",
      );
      return;
    }

    if (url.trim() && !url.trim().startsWith("https://")) {
      setError("A URL deve começar com https://");
      return;
    }

    setIsSubmitting(true);

    try {
      const genders = gender === "male" ? [1] : gender === "female" ? [2] : [];
      const geoLocations = buildGeoLocationsPayload(selectedLocations);

      const body: Record<string, unknown> = {
        userId,
        campaignId,
        campaignObjective,
        adsetName: adsetName.trim(),
        targeting: {
          age_min: ageMinValue,
          age_max: ageMaxValue,
          placements: selectedPlacements,
          ...(genders.length > 0 && { genders }),
          ...(includedAudiences.length > 0 && {
            custom_audiences: includedAudiences.map((a) => ({
              id: a.id,
              name: a.name,
            })),
          }),
          ...(excludedAudiences.length > 0 && {
            excluded_custom_audiences: excludedAudiences.map((a) => ({
              id: a.id,
              name: a.name,
            })),
          }),
          ...(hasInterestTargetingConfigured(interestTargeting) && {
            interest_targeting: interestTargeting,
          }),
          ...(geoLocations && { geo_locations: geoLocations }),
        },
      };

      if (selectedPageId) body.pageId = selectedPageId;
      if (selectedPixelId) body.pixelId = selectedPixelId;

      if (!usesCampaignBudget) {
        body.budgetType = budgetType;
        body.budgetValue = parsedBudget;
        if (budgetType === "lifetime") {
          body.startTime = dateTimeLocalToMeta(startDateTime);
          body.endTime = dateTimeLocalToMeta(endDateTime);
        }
      }

      if (canEditDeliverySchedule) {
        body.deliveryMode = deliverySchedule.deliveryMode;
        if (deliverySchedule.deliveryMode === "specific_hours") {
          body.scheduleBlocks = deliverySchedule.scheduleBlocks;
        }
      }

      if (hasPosts) {
        body.creatives = selectedPosts.map((p) => ({
          instagramMediaId: p.id,
        }));
      }

      if (url.trim()) body.url = url.trim();

      const response = await fetch(`/api/meta-marketing/${accountId}/adsets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok && response.status !== 207) {
        throw new Error(data.message ?? "Falha ao criar conjunto de anúncios");
      }

      void invalidateMarketing();

      if (response.status === 207) {
        setError(
          data.message ??
            "Conjunto criado, mas algum anúncio não pôde ser adicionado automaticamente.",
        );
        onSuccess();
        return;
      }

      onSuccess();
      resetForm();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro ao criar conjunto de anúncios",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Criar conjunto de anúncios</DialogTitle>
            <DialogDescription>
              {campaignName
                ? `Criando em: ${campaignName}`
                : "Configure o orçamento, público e veiculação do novo conjunto."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="adsetName">
                Nome do conjunto <span className="text-destructive">*</span>
              </Label>
              <Input
                id="adsetName"
                value={adsetName}
                onChange={(e) => setAdsetName(e.target.value)}
                placeholder="Ex.: Público frio — Feed"
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label>Página do Facebook</Label>
              <PageSelector
                pages={pages}
                isLoading={isLoadingPages}
                selectedPageId={selectedPageId}
                onSelectPage={setSelectedPageId}
                disabled={isSubmitting}
              />
            </div>

            {isSalesCampaign && (
              <div className="space-y-2">
                <Label>
                  Pixel Meta <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={selectedPixelId ?? undefined}
                  onValueChange={setSelectedPixelId}
                  disabled={isSubmitting || isLoadingPixels}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o pixel" />
                  </SelectTrigger>
                  <SelectContent>
                    {pixels.map((pixel) => (
                      <SelectItem key={pixel.id} value={pixel.id}>
                        {pixel.name ?? pixel.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Orçamento</Label>
              {usesCampaignBudget ? (
                <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  O orçamento desta campanha é gerenciado no nível da campanha
                  (CBO). O conjunto herdará o orçamento da campanha.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={budgetType === "daily" ? "default" : "outline"}
                      onClick={() => setBudgetType("daily")}
                      disabled={isSubmitting}
                      className="flex-1"
                    >
                      Diário
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={budgetType === "lifetime" ? "default" : "outline"}
                      onClick={() => setBudgetType("lifetime")}
                      disabled={isSubmitting}
                      className="flex-1"
                    >
                      Total
                    </Button>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      R$
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      min="1"
                      value={budgetValue}
                      onChange={(e) => setBudgetValue(e.target.value)}
                      placeholder="15.00"
                      className="pl-10"
                      disabled={isSubmitting}
                    />
                  </div>
                  {budgetType === "lifetime" && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="startDateTime">Data de início</Label>
                        <Input
                          id="startDateTime"
                          type="datetime-local"
                          value={startDateTime}
                          onChange={(e) => setStartDateTime(e.target.value)}
                          disabled={isSubmitting}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="endDateTime">Data de término</Label>
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
                </div>
              )}
            </div>

            {canEditDeliverySchedule && (
              <AdSetDeliveryScheduleEditor
                value={deliverySchedule}
                onChange={setDeliverySchedule}
                disabled={isSubmitting}
              />
            )}

            <div className="space-y-2">
              <Label>Posicionamentos</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {availablePlacements.map((key) => {
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
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ageMin">Idade mínima</Label>
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
                <Label htmlFor="ageMax">Idade máxima</Label>
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
            </div>

            <div className="space-y-2">
              <Label>Incluir públicos</Label>
              <AudienceMultiSelect
                label="Selecionar públicos para incluir..."
                audiences={availableAudiences}
                selected={includedAudiences}
                onChange={setIncludedAudiences}
                disabled={isSubmitting}
                isLoading={isLoadingAudiences}
              />
            </div>

            <div className="space-y-2">
              <Label>Excluir públicos</Label>
              <AudienceMultiSelect
                label="Selecionar públicos para excluir..."
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

            <InterestTargetingSection
              accountId={accountId}
              userId={userId}
              value={interestTargeting}
              onChange={setInterestTargeting}
              disabled={isSubmitting}
            />

            {isSalesCampaign && (
              <div className="space-y-2">
                <Label htmlFor="url">
                  URL de destino{" "}
                  {hasPosts && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  id="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.exemplo.com/produto"
                  disabled={isSubmitting}
                />
                <p className="text-xs text-muted-foreground">
                  URL do produto ou página de destino para o botão &quot;Pedir
                  agora&quot; (quando criativos forem adicionados).
                </p>
              </div>
            )}

            {isLeadsCampaign && hasPosts && (
              <Alert>
                <Info className="size-4" />
                <AlertDescription>
                  Um formulário de captação de leads será criado automaticamente
                  com campos de Nome, E-mail e Telefone.
                </AlertDescription>
              </Alert>
            )}

            {isTrafficCampaign && hasPosts && (
              <Alert>
                <Info className="size-4" />
                <AlertDescription>
                  Os anúncios terão um botão &quot;Saiba mais&quot; que
                  direcionará para o perfil do Instagram.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label>
                Criativos (Posts do Instagram){" "}
                <span className="text-xs text-muted-foreground font-normal">
                  {selectedPosts.length}/{MAX_MEDIA_ITEMS}
                </span>
              </Label>

              {selectedPosts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedPosts.map((post, index) => {
                    const isVideo =
                      post.media_type === "VIDEO" ||
                      post.media_type === "REELS";
                    const previewUrl = isVideo
                      ? (post.media_url ?? null)
                      : (post.thumbnail_url ?? post.media_url ?? null);

                    return (
                      <div key={post.id} className="relative group">
                        <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-border bg-muted">
                          {previewUrl ? (
                            isVideo ? (
                              <video
                                src={previewUrl}
                                className="w-full h-full object-cover"
                                muted
                              />
                            ) : (
                              <Image
                                src={previewUrl}
                                alt={post.caption ?? "Post selecionado"}
                                width={80}
                                height={80}
                                className="w-full h-full object-cover"
                              />
                            )
                          ) : (
                            <div className="flex w-full h-full items-center justify-center">
                              <ImageIcon className="size-5 text-muted-foreground" />
                            </div>
                          )}

                          <div className="absolute left-1 top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground shadow">
                            {index + 1}
                          </div>

                          <button
                            type="button"
                            onClick={() => removePost(post.id)}
                            disabled={isSubmitting}
                            className="absolute top-1 right-1 rounded-full bg-destructive p-0.5 text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsMediaPickerOpen(true)}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto"
                >
                  <ImageIcon className="size-4 mr-2" />
                  {hasPosts
                    ? "Alterar seleção"
                    : "Selecionar posts do Instagram"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Opcional. Selecione até {MAX_MEDIA_ITEMS} posts. Um anúncio
                  será criado para cada post selecionado.
                </p>
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
                {isSubmitting && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Criar conjunto
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isMediaPickerOpen}
        onOpenChange={(open) => !open && setIsMediaPickerOpen(false)}
      >
        <DialogContent className="sm:max-w-[640px] max-h-[85vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle>Selecionar Posts do Instagram</DialogTitle>
            <DialogDescription>
              Escolha até {MAX_MEDIA_ITEMS} posts para usar como criativos dos
              anúncios
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4">
            <InstagramPostPicker
              accountId={accountId}
              userId={userId}
              maxSelection={MAX_MEDIA_ITEMS}
              selectedPosts={selectedPosts}
              onSelectionChange={setSelectedPosts}
              instagramBusinessAccountId={selectedInstagramAccountId}
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-6 pb-6">
            <p className="text-sm text-muted-foreground">
              {selectedPosts.length} de {MAX_MEDIA_ITEMS} selecionado
              {selectedPosts.length !== 1 ? "s" : ""}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setIsMediaPickerOpen(false)}
              >
                Cancelar
              </Button>
              <Button onClick={() => setIsMediaPickerOpen(false)}>
                Confirmar seleção
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
