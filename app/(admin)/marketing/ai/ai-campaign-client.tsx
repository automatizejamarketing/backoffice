"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { addDays, format, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, CalendarIcon, Loader2, Sparkles } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MediaSourcePicker, type SelectedMedia } from "../components/media-source-picker";
import { PageSelector } from "../components/page-selector";
import { usePages } from "../components/use-pages";
import { LocationTargetingSection } from "../components/location-targeting-section";
import {
  AdSetDeliveryScheduleEditor,
  type AdSetDeliveryScheduleValue,
} from "../components/adset-delivery-schedule-editor";
import { useCompanyProfile } from "../hooks/use-company-locations";
import {
  buildSavedCustomLocations,
  needsAiLocationStep,
  resolveEffectiveAiLocations,
} from "@/lib/onboarding/business-geo-defaults";
import { scheduleFromLocationHours } from "@/lib/meta-business/location-hours";
import {
  ADVISED_MIN_DAILY_BUDGET,
  DEFAULT_DAILY_BUDGET,
  DEFAULT_FLIGHT_DAYS,
  MAX_MEDIAS,
  needsTexts as planNeedsTexts,
  type PlanMedia,
} from "@/lib/meta-business/marketing/ai-creation/build-tree";
import type {
  MoldRef,
  ProvenAdRef,
  ReviewSummary,
} from "@/lib/meta-business/marketing/ai-creation";
import {
  hasAppliedDemographicLimits,
  type DemographicLimits,
} from "@/lib/meta-business/marketing/ai-creation/demographic-limits";
import type { AudienceExclusionIds } from "@/lib/meta-business/marketing/ai-creation/audience-exclusions";
import type { AudienceInclusionIds } from "@/lib/meta-business/marketing/ai-creation/audience-inclusions";
import type { SelectedGeoLocation } from "@/lib/meta-business/geo-targeting-types";
import {
  ALL_PLACEMENTS,
  INSTAGRAM_PLACEMENTS,
  type PlacementKey,
} from "@/lib/meta-business/placements";
import { cn } from "@/lib/utils";
import {
  AiPlacementsEditor,
  placementsSummary,
  type PlacementsMode,
} from "./ai-placements-editor";
import { WhatsappDestinationCard } from "./whatsapp-destination-card";
import { usePageWhatsappNumber } from "../hooks/use-page-whatsapp-number";
import { AiDemographicLimitsEditor } from "./ai-demographic-limits-editor";
import { AiAudienceLibraryDialog } from "./ai-audience-library-dialog";
import { AiAudienceExclusionsEditor } from "./ai-audience-exclusions-editor";
import { AiAudienceInclusionsEditor } from "./ai-audience-inclusions-editor";

type Phase =
  | "objective"
  | "scanning"
  | "proven_ads"
  | "budget"
  | "media"
  | "text"
  | "location"
  | "pixel"
  | "review"
  | "publishing";

type Objective = "sales" | "whatsapp" | "followers" | "leads";

type VideoUpload = {
  state: "uploading" | "processing" | "ready" | "error";
  videoId?: string;
  thumbnailUrl?: string;
};

type PlanIssue = {
  reason?: string;
  message?: string;
  suggestion?: string;
};

type AudienceReviewAdSet = NonNullable<ReviewSummary["audience"]["adSets"]>[number];

function audienceGeoLabel(geo: AudienceReviewAdSet["geo"]): string {
  if (geo.locations?.length) {
    return geo.locations
      .map((location) =>
        location.radiusKm != null
          ? `${location.label} · ${location.radiusKm} km`
          : location.label,
      )
      .join(" · ");
  }
  return [
    geo.customLocations ? `${geo.customLocations} endereço(s)` : "",
    geo.cities ? `${geo.cities} cidade(s)` : "",
    geo.regions ? `${geo.regions} região(ões)` : "",
    geo.countries ? `${geo.countries} país(es)` : "",
  ]
    .filter(Boolean)
    .join(" + ") || "não especificada";
}

function audienceGenderLabel(genders: number[] | undefined): string {
  if (genders?.includes(1) && genders.includes(2)) return "homens e mulheres";
  if (genders?.includes(1)) return "homens";
  if (genders?.includes(2)) return "mulheres";
  return "não especificado";
}

const OBJECTIVE_LABEL: Record<Objective, string> = {
  sales: "Vendas",
  whatsapp: "WhatsApp",
  followers: "Seguidores",
  leads: "Leads",
};

const BUDGET_PRESETS = ["20", "30", "50", "100"] as const;

const CTA_OPTIONS = [
  "LEARN_MORE",
  "SHOP_NOW",
  "ORDER_NOW",
  "SEE_MENU",
  "GET_OFFER",
  "SIGN_UP",
  "CONTACT_US",
  "WHATSAPP_MESSAGE",
  "MESSAGE_PAGE",
  "SUBSCRIBE",
  "DOWNLOAD",
  "APPLY_NOW",
  "GET_QUOTE",
  "BOOK_TRAVEL",
] as const;

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) =>
  `${hour.toString().padStart(2, "0")}:00`,
);
const END_TIME_OPTIONS = [...HOUR_OPTIONS, "23:59"];

function fallbackAcceptsSchedule(niche: string, objective: Objective): boolean {
  const normalized = niche === "service" ? "insurance_broker" : niche;
  if (objective === "whatsapp") return normalized === "food_service";
  if (objective !== "sales") return false;
  return normalized === "food_service" || normalized === "outros";
}

function apiPath(accountId: string, userId: string, suffix: string) {
  return `/api/meta-marketing/${accountId}/campaigns/ai/${suffix}?userId=${userId}`;
}

function mediaToPlan(media: SelectedMedia, video?: VideoUpload): PlanMedia | null {
  if (media.source === "instagram") {
    return { kind: "instagram_post", instagramMediaId: media.instagramMediaId };
  }
  if (media.source === "automatize_media") {
    return { kind: "image", imageUrl: media.previewUrl };
  }
  if (media.mediaType === "video") {
    if (video?.state === "ready" && video.videoId) {
      return {
        kind: "video",
        videoId: video.videoId,
        thumbnailUrl: video.thumbnailUrl,
      };
    }
    return null;
  }
  return { kind: "image", imageUrl: media.blobUrl };
}

function combineDateTime(date: Date, time: string): string {
  const [hours, minutes] = time.split(":");
  const next = new Date(date);
  next.setHours(Number(hours ?? 0), Number(minutes ?? 0), 0, 0);
  return next.toISOString();
}

export function AiCampaignClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = searchParams.get("userId") ?? "";
  const accountId = searchParams.get("accountId") ?? "";

  const { pages, isLoading: isLoadingPages } = usePages(accountId, userId, Boolean(accountId && userId));
  const { data: companyProfile } = useCompanyProfile(userId);
  const businessUnits = companyProfile?.locations ?? [];
  const savedLocations = useMemo(
    () =>
      buildSavedCustomLocations(
        companyProfile?.company ?? null,
        companyProfile?.locations ?? [],
      ),
    [companyProfile],
  );
  const rawNiche = companyProfile?.company?.niche ?? "outros";
  const companyNiche = [
    "food_service",
    "retail",
    "real_estate_broker",
    "service",
    "insurance_broker",
    "outros",
  ].includes(rawNiche)
    ? rawNiche
    : "outros";

  const [phase, setPhase] = useState<Phase>("objective");
  const [objective, setObjective] = useState<Objective>("sales");
  const [mold, setMold] = useState<MoldRef | null>(null);
  const [provenAds, setProvenAds] = useState<ProvenAdRef[]>([]);
  const [keepAdIds, setKeepAdIds] = useState<string[]>([]);
  const [currency, setCurrency] = useState("BRL");
  const [dailyBudget, setDailyBudget] = useState(String(DEFAULT_DAILY_BUDGET));
  const [selectedMedias, setSelectedMedias] = useState<SelectedMedia[]>([]);
  const [videoUploads, setVideoUploads] = useState<Record<string, VideoUpload>>({});
  const [headline, setHeadline] = useState("");
  const [message, setMessage] = useState("");
  const [offer, setOffer] = useState("");
  const [ctaType, setCtaType] = useState<string>("LEARN_MORE");
  const [isWritingCopy, setIsWritingCopy] = useState(false);
  const [pageId, setPageId] = useState<string | null>(null);
  const [pixelId, setPixelId] = useState<string | null>(null);
  const [pixels, setPixels] = useState<Array<{ id: string; name?: string }>>([]);
  const [manualLocations, setManualLocations] = useState<SelectedGeoLocation[]>([]);
  const [promotionUrl, setPromotionUrl] = useState("");
  const [whatsappAutofillMessage, setWhatsappAutofillMessage] = useState("");
  const [whatsappGreeting, setWhatsappGreeting] = useState("");
  const [deliverySchedule, setDeliverySchedule] = useState<AdSetDeliveryScheduleValue>({
    deliveryMode: "specific_hours",
    scheduleBlocks: [],
  });
  const [placementsMode, setPlacementsMode] = useState<PlacementsMode>("automatic");
  const [selectedPlacements, setSelectedPlacements] = useState<PlacementKey[]>([]);
  const [demographics, setDemographics] = useState<DemographicLimits | undefined>(undefined);
  const [excludedCustomAudienceIds, setExcludedCustomAudienceIds] = useState<AudienceExclusionIds | undefined>(undefined);
  const [includedCustomAudienceIds, setIncludedCustomAudienceIds] = useState<AudienceInclusionIds | undefined>(undefined);
  const [audienceLibraryOpen, setAudienceLibraryOpen] = useState(false);
  const [periodStart, setPeriodStart] = useState(() => startOfDay(new Date()));
  const [periodEnd, setPeriodEnd] = useState(() =>
    addDays(startOfDay(new Date()), DEFAULT_FLIGHT_DAYS - 1),
  );
  const [periodStartTime, setPeriodStartTime] = useState("00:00");
  const [periodEndTime, setPeriodEndTime] = useState("23:59");
  const [planIssues, setPlanIssues] = useState<PlanIssue[]>([]);
  const [plannedAudience, setPlannedAudience] = useState<ReviewSummary["audience"]>();
  const [plannedExcludedAudienceCount, setPlannedExcludedAudienceCount] = useState<number | undefined>();
  const [plannedIncludedAudienceCount, setPlannedIncludedAudienceCount] = useState<number | undefined>();
  const [daypartingAllowed, setDaypartingAllowed] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const startedVideos = useRef(new Set<string>());

  const selectedPage = pages.find((page) => page.pageId === pageId) ?? pages[0] ?? null;
  const hasMold = Boolean(mold);
  const planMedias = useMemo(
    () =>
      selectedMedias
        .map((media) =>
          mediaToPlan(
            media,
            media.source === "device" ? videoUploads[media.blobUrl] : undefined,
          ),
        )
        .filter((media): media is PlanMedia => media != null),
    [selectedMedias, videoUploads],
  );
  const needsTexts = planNeedsTexts(planMedias);
  const needsPixel = objective === "sales" && !hasMold && !pixelId;
  const effectiveLocations = resolveEffectiveAiLocations(
    manualLocations,
    savedLocations,
  );
  const needsLocation = needsAiLocationStep(hasMold, effectiveLocations);
  const showDeliverySchedule = hasMold
    ? daypartingAllowed
    : fallbackAcceptsSchedule(companyNiche, objective);
  const pendingVideos = selectedMedias.some(
    (media) =>
      media.source === "device" &&
      media.mediaType === "video" &&
      videoUploads[media.blobUrl]?.state !== "ready",
  );

  const localAudienceReview = useMemo<ReviewSummary["audience"]>(() => {
    const geo = {
      customLocations: effectiveLocations.filter((location) => location.type === "custom_location").length,
      cities: effectiveLocations.filter((location) => location.type === "city").length,
      regions: effectiveLocations.filter((location) => location.type === "region").length,
      countries: effectiveLocations.filter((location) => location.type === "country").length,
      ...(effectiveLocations.length
        ? {
            locations: effectiveLocations.map((location) => ({
              label: location.name,
              ...(location.radius != null ? { radiusKm: location.radius } : {}),
            })),
          }
        : {}),
    };
    const placements =
      placementsMode === "automatic"
        ? { automatic: true as const }
        : { automatic: false as const, platforms: [...selectedPlacements] };
    const advantagePlus =
      !hasAppliedDemographicLimits(demographics) &&
      !(includedCustomAudienceIds?.length);
    const includedIds = [...(includedCustomAudienceIds ?? [])];
    const excludedIds = [...(excludedCustomAudienceIds ?? [])];
    const overlappingIds = includedIds.filter((id) => excludedIds.includes(id));
    const effectiveIncludedIds = includedIds.filter((id) => !excludedIds.includes(id));
    const adSet = {
      index: 0,
      geo,
      advantagePlus,
      interestGroups: 0,
      customAudiences: includedIds.length,
      includedCustomAudienceIds: includedIds,
      excludedCustomAudienceIds: excludedIds,
      effectiveCustomAudiences: effectiveIncludedIds.length,
      overlappingCustomAudiences: overlappingIds.length,
      ...(includedCustomAudienceIds !== undefined
        ? { includedCustomAudiencesApplied: true }
        : {}),
      excludedCustomAudiences: excludedIds.length,
      ...(excludedCustomAudienceIds !== undefined
        ? { excludedCustomAudiencesApplied: true }
        : {}),
      placements,
      ...(demographics?.age
        ? { ageMin: demographics.age.min, ageMax: demographics.age.max }
        : {}),
      ...(demographics?.genders?.length ? { genders: [...demographics.genders] } : {}),
      ageSource: demographics?.age != null ? ("applied" as const) : ("inherited" as const),
      genderSource:
        demographics?.genders != null ? ("applied" as const) : ("inherited" as const),
    };
    return {
      geo,
      advantagePlus,
      interestGroups: 0,
      customAudiences: includedIds.length,
      includedCustomAudienceIds: includedIds,
      excludedCustomAudienceIds: excludedIds,
      effectiveCustomAudiences: effectiveIncludedIds.length,
      overlappingCustomAudiences: overlappingIds.length,
      ...(includedCustomAudienceIds !== undefined
        ? { includedCustomAudiencesApplied: true }
        : {}),
      excludedCustomAudiences: excludedIds.length,
      ...(excludedCustomAudienceIds !== undefined
        ? { excludedCustomAudiencesApplied: true }
        : {}),
      placements,
      ...(demographics?.age
        ? { ageMin: demographics.age.min, ageMax: demographics.age.max }
        : {}),
      ...(demographics?.genders?.length ? { genders: [...demographics.genders] } : {}),
      adSets: [adSet],
    };
  }, [
    demographics,
    effectiveLocations,
    excludedCustomAudienceIds,
    includedCustomAudienceIds,
    placementsMode,
    selectedPlacements,
  ]);
  const effectiveAudienceReview = hasMold ? plannedAudience : localAudienceReview;

  const backHref = `/users/${userId}?tab=marketing`;

  useEffect(() => {
    if (pages.length > 0 && !pageId) {
      setPageId(pages[0].pageId);
    }
  }, [pages, pageId]);

  useEffect(() => {
    const website = companyProfile?.company?.websiteUrl?.trim();
    if (website && !promotionUrl) {
      setPromotionUrl(website);
    }
  }, [companyProfile?.company?.websiteUrl, promotionUrl]);

  useEffect(() => {
    if (deliverySchedule.scheduleBlocks.length > 0) return;
    const primary =
      businessUnits.find((unit) => unit.isPrimary) ?? businessUnits[0];
    if (!primary) return;
    const preset = scheduleFromLocationHours(primary.businessOperatingHours);
    if (preset) setDeliverySchedule(preset);
  }, [businessUnits, deliverySchedule.scheduleBlocks.length]);

  useEffect(() => {
    if (!accountId || !userId) return;
    fetch(`/api/meta-marketing/${accountId}/pixels?userId=${userId}`)
      .then((res) => (res.ok ? res.json() : { pixels: [] }))
      .then((data) => {
        const list = (data.pixels ?? data.data ?? []) as Array<{ id: string; name?: string }>;
        setPixels(list);
        if (list[0] && !pixelId) setPixelId(list[0].id);
      })
      .catch(() => setPixels([]));
  }, [accountId, userId, pixelId]);

  useEffect(() => {
    if (objective === "whatsapp") {
      setCtaType("WHATSAPP_MESSAGE");
    }
  }, [objective]);

  /**
   * Where the WhatsApp campaign actually lands. Owned here, not inside the destination card,
   * because the publish gate reads it too: an explicit `not_linked` blocks (ADR 0032), while
   * "we are not allowed to look" — every answer today — does not.
   */
  const whatsappNumber = usePageWhatsappNumber(
    selectedPage?.pageId ?? pageId,
    objective === "whatsapp",
    accountId,
    userId,
  );
  const whatsappPageNotLinked =
    whatsappNumber.state.phase === "resolved" &&
    whatsappNumber.state.data.status === "not_linked";

  useEffect(() => {
    if (objective === "followers") {
      setPlacementsMode("manual");
      setSelectedPlacements((current) => {
        const kept = current.filter((key) =>
          (INSTAGRAM_PLACEMENTS as readonly PlacementKey[]).includes(key),
        );
        return kept.length > 0 ? kept : [...INSTAGRAM_PLACEMENTS];
      });
      return;
    }
    setPlacementsMode("automatic");
    setSelectedPlacements([]);
  }, [objective]);

  useEffect(() => {
    if (!accountId || !userId) return;
    for (const media of selectedMedias) {
      if (media.source !== "device" || media.mediaType !== "video") continue;
      if (startedVideos.current.has(media.blobUrl)) continue;
      startedVideos.current.add(media.blobUrl);
      setVideoUploads((prev) => ({
        ...prev,
        [media.blobUrl]: { state: "uploading" },
      }));
      fetch(apiPath(accountId, userId, "video"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: media.blobUrl }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.message ?? "Falha ao enviar o vídeo.");
          }
          setVideoUploads((prev) => ({
            ...prev,
            [media.blobUrl]: {
              state: "processing",
              videoId: data.videoId,
              thumbnailUrl: data.thumbnailUrl,
            },
          }));
        })
        .catch((err) => {
          setVideoUploads((prev) => ({
            ...prev,
            [media.blobUrl]: { state: "error" },
          }));
          toast.error(err instanceof Error ? err.message : "Falha ao enviar o vídeo.");
        });
    }
  }, [accountId, userId, selectedMedias]);

  useEffect(() => {
    const processing = Object.entries(videoUploads).filter(
      ([, upload]) => upload.state === "processing" && upload.videoId,
    );
    if (processing.length === 0 || !accountId || !userId) return;
    const ids = processing.map(([, upload]) => upload.videoId).join(",");
    let cancelled = false;
    const timer = window.setInterval(async () => {
      const res = await fetch(
        `${apiPath(accountId, userId, "video-status")}&videoIds=${ids}`,
      );
      const data = await res.json();
      if (cancelled) return;
      setVideoUploads((prev) => {
        const next = { ...prev };
        for (const [blobUrl, upload] of processing) {
          const status = upload.videoId
            ? data.data?.statuses?.[upload.videoId]
            : undefined;
          if (status?.state === "ready") {
            next[blobUrl] = { ...upload, state: "ready" };
          }
          if (status?.state === "error") {
            next[blobUrl] = { ...upload, state: "error" };
          }
        }
        return next;
      });
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [accountId, userId, videoUploads]);

  if (!userId || !accountId) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          Selecione um cliente e uma conta de anúncios para criar a campanha.
        </p>
        <Button className="mt-4" onClick={() => router.push("/portfolio")} variant="outline">
          Voltar
        </Button>
      </div>
    );
  }

  function buildAnswers(
    overrides: {
      demographics?: DemographicLimits;
      excludedCustomAudienceIds?: AudienceExclusionIds;
      includedCustomAudienceIds?: AudienceInclusionIds;
      pageId?: string | null;
      pixelId?: string | null;
      dailyBudget?: string;
      placementsMode?: PlacementsMode;
      selectedPlacements?: PlacementKey[];
    } = {},
  ) {
    const hasExcludedAudienceOverride = Object.hasOwn(overrides, "excludedCustomAudienceIds");
    const effectiveExcludedCustomAudienceIds = hasExcludedAudienceOverride
      ? overrides.excludedCustomAudienceIds
      : excludedCustomAudienceIds;
    const hasIncludedAudienceOverride = Object.hasOwn(overrides, "includedCustomAudienceIds");
    const effectiveIncludedCustomAudienceIds = hasIncludedAudienceOverride
      ? overrides.includedCustomAudienceIds
      : includedCustomAudienceIds;
    const hasDemographicOverride = Object.hasOwn(overrides, "demographics");
    const effectiveDemographics = hasDemographicOverride
      ? overrides.demographics
      : demographics;
    const effectivePixelId = Object.hasOwn(overrides, "pixelId")
      ? overrides.pixelId
      : pixelId;
    const effectivePageId = Object.hasOwn(overrides, "pageId")
      ? overrides.pageId
      : selectedPage?.pageId;
    const effectivePage =
      pages.find((page) => page.pageId === effectivePageId) ?? selectedPage;
    return {
      dailyBudget: Number(overrides.dailyBudget ?? dailyBudget) || DEFAULT_DAILY_BUDGET,
      medias: planMedias,
      texts: {
        headline,
        message,
        ctaType,
        link: promotionUrl || undefined,
      },
      pageId: effectivePageId ?? undefined,
      instagramUserId: effectivePage?.instagramBusinessAccountId,
      pixelId: effectivePixelId || undefined,
      keepAdIds: hasMold ? keepAdIds : undefined,
      ...(showDeliverySchedule
        ? {
            deliveryMode: deliverySchedule.deliveryMode,
            scheduleBlocks:
              deliverySchedule.deliveryMode === "specific_hours"
                ? deliverySchedule.scheduleBlocks
                : [],
          }
        : {}),
      placementsMode: overrides.placementsMode ?? placementsMode,
      ...((overrides.placementsMode ?? placementsMode) === "manual"
        ? { selectedPlacements: overrides.selectedPlacements ?? selectedPlacements }
        : {}),
      ...(hasAppliedDemographicLimits(effectiveDemographics)
        ? { demographics: effectiveDemographics }
        : {}),
      ...(effectiveExcludedCustomAudienceIds !== undefined
        ? { excludedCustomAudienceIds: effectiveExcludedCustomAudienceIds }
        : {}),
      ...(effectiveIncludedCustomAudienceIds !== undefined
        ? { includedCustomAudienceIds: effectiveIncludedCustomAudienceIds }
        : {}),
    };
  }

  async function refreshPlan(
    overrides: {
      demographics?: DemographicLimits;
      excludedCustomAudienceIds?: AudienceExclusionIds;
      includedCustomAudienceIds?: AudienceInclusionIds;
      pageId?: string | null;
      pixelId?: string | null;
      dailyBudget?: string;
      placementsMode?: PlacementsMode;
      selectedPlacements?: PlacementKey[];
    } = {},
  ) {
    if (!mold) return;
    try {
      const res = await fetch(apiPath(accountId, userId, "plan"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mold, answers: buildAnswers(overrides) }),
      });
      const data = await res.json();
      setPlanIssues(Array.isArray(data.issues) ? data.issues : []);
      setPlannedAudience(data.review?.audience);
      setDaypartingAllowed(data.review?.budget?.daypartingAllowed !== false);
      setPlannedExcludedAudienceCount(
        typeof data.review?.audience?.excludedCustomAudiences === "number"
          ? data.review.audience.excludedCustomAudiences
          : undefined,
      );
      setPlannedIncludedAudienceCount(
        typeof data.review?.audience?.customAudiences === "number"
          ? data.review.audience.customAudiences
          : undefined,
      );
    } catch {
      setPlanIssues([]);
      setPlannedAudience(undefined);
    }
  }

  async function scanAccount() {
    setIsBusy(true);
    setError(null);
    setPlanIssues([]);
    setPlannedAudience(undefined);
    setPhase("scanning");
    try {
      const res = await fetch(apiPath(accountId, userId, "scan"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message ?? "Não foi possível analisar a conta.");
      }
      setCurrency(data.currency ?? "BRL");
      setMold(objective === "whatsapp" ? null : (data.mold ?? null));
      setProvenAds(objective === "whatsapp" ? [] : (data.provenAds ?? []));
      setKeepAdIds(
        objective === "whatsapp"
          ? []
          : (data.provenAds ?? []).map((ad: ProvenAdRef) => ad.adId),
      );
      setPhase(
        objective === "whatsapp"
          ? "budget"
          : data.mold
            ? "proven_ads"
            : "budget",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no scan.");
      setPhase("objective");
    } finally {
      setIsBusy(false);
    }
  }

  async function writeCopy() {
    if (!offer.trim()) {
      toast.error("Descreva a oferta para a IA escrever o anúncio.");
      return;
    }
    setIsWritingCopy(true);
    try {
      const res = await fetch(apiPath(accountId, userId, "copy"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offer,
          objective:
            objective === "whatsapp"
              ? "whatsapp"
              : objective === "leads"
                ? "leads"
                : "sales",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message ?? "Não foi possível escrever o anúncio.");
      }
      setHeadline(data.headline);
      setMessage(data.message);
      if (data.whatsappAutofillMessage) {
        setWhatsappAutofillMessage(data.whatsappAutofillMessage);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao gerar texto.");
    } finally {
      setIsWritingCopy(false);
    }
  }

  async function goToReview() {
    setPhase("review");
    if (hasMold) void refreshPlan();
  }

  async function publish() {
    if (planMedias.length === 0) {
      toast.error("Selecione ao menos uma mídia pronta para publicar.");
      return;
    }
    if (pendingVideos) {
      toast.error("Aguarde os vídeos ficarem prontos na Meta.");
      return;
    }
    if (!selectedPage) {
      toast.error("Selecione a página do anúncio.");
      return;
    }
    if (objective === "whatsapp" && !whatsappAutofillMessage.trim()) {
      toast.error("Escreva a primeira mensagem que o cliente já vai ver digitada no WhatsApp.");
      return;
    }
    if (objective === "whatsapp" && whatsappPageNotLinked) {
      toast.error(
        "Esta Página não tem número de WhatsApp vinculado. Adicione um na Meta antes de publicar.",
      );
      return;
    }
    if (!hasMold && effectiveLocations.length === 0) {
      toast.error("Selecione ao menos uma localização para segmentação");
      return;
    }
    if (placementsMode === "manual" && selectedPlacements.length === 0) {
      toast.error("Escolha ao menos um posicionamento.");
      return;
    }
    if (
      showDeliverySchedule &&
      deliverySchedule.deliveryMode === "specific_hours" &&
      deliverySchedule.scheduleBlocks.length === 0
    ) {
      toast.error("Escolha ao menos um horário de veiculação, ou use o dia todo.");
      return;
    }
    setIsBusy(true);
    setPhase("publishing");
    setError(null);
    try {
      const answers = buildAnswers();

      if (hasMold && mold) {
        const res = await fetch(apiPath(accountId, userId, "create"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mold, answers }),
        });
        const data = await res.json();
        if (!res.ok || !data.success || data.ok === false) {
          throw new Error(data.message ?? data.issues?.[0]?.reason ?? data.issues?.[0]?.message ?? "Falha ao criar.");
        }
      } else {
        const res = await fetch(apiPath(accountId, userId, "fallback"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            niche: companyNiche,
            objective,
            dailyBudget: answers.dailyBudget,
            medias: answers.medias,
            texts: answers.texts,
            pageId: selectedPage.pageId,
            instagramUserId: selectedPage.instagramBusinessAccountId,
            pixelId,
            promotionUrl,
            locations: effectiveLocations,
            deliveryMode: deliverySchedule.deliveryMode,
            scheduleBlocks: answers.scheduleBlocks,
            placementsMode,
            selectedPlacements:
              placementsMode === "manual" ? selectedPlacements : undefined,
            demographics,
            excludedCustomAudienceIds,
            includedCustomAudienceIds,
            period: {
              startTime: combineDateTime(periodStart, periodStartTime),
              endTime: combineDateTime(periodEnd, periodEndTime),
            },
            ...(objective === "whatsapp"
              ? {
                  whatsappWelcome: {
                    autofillMessage: whatsappAutofillMessage.trim(),
                    ...(whatsappGreeting.trim()
                      ? { greeting: whatsappGreeting.trim() }
                      : {}),
                  },
                }
              : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success || data.ok === false) {
          throw new Error(data.message ?? data.issues?.[0]?.reason ?? data.issues?.[0]?.message ?? "Falha ao criar.");
        }
      }

      toast.success("Campanha criada e publicada.");
      router.push(backHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao publicar.");
      setPhase("review");
    } finally {
      setIsBusy(false);
    }
  }

  function goNextFromBudget() {
    setPhase("media");
  }

  function advanceAfterCreative() {
    if (needsLocation) {
      setPhase("location");
      return;
    }
    if (needsPixel) {
      setPhase("pixel");
      return;
    }
    void goToReview();
  }

  function goNextFromMedia() {
    if (selectedMedias.length === 0) {
      toast.error("Escolha ao menos uma mídia.");
      return;
    }
    if (pendingVideos) {
      toast.error("Aguarde o vídeo ficar pronto na Meta.");
      return;
    }
    if (needsTexts) {
      setPhase("text");
      return;
    }
    advanceAfterCreative();
  }

  function goNextFromText() {
    if (needsTexts && (!headline.trim() || !message.trim())) {
      toast.error("Preencha título e texto do anúncio.");
      return;
    }
    advanceAfterCreative();
  }

  function goNextFromLocation() {
    if (manualLocations.length === 0) {
      toast.error("Selecione ao menos uma localização para segmentação");
      return;
    }
    if (needsPixel) {
      setPhase("pixel");
      return;
    }
    void goToReview();
  }

  function openLocationStep() {
    if (manualLocations.length === 0 && savedLocations.length > 0) {
      setManualLocations(savedLocations);
    }
    setPhase("location");
  }

  const periodLabel = `${format(periodStart, "dd/MM/yy")} – ${format(periodEnd, "dd/MM/yy")}`;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Button onClick={() => router.push(backHref)} size="icon" variant="ghost">
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Criar campanha com IA</h1>
          <p className="text-sm text-muted-foreground">
            Tudo o que o cliente faz no app, na conta selecionada.
          </p>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {phase === "objective" && (
        <Card>
          <CardHeader>
            <CardTitle>O que esta campanha deve gerar?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {(Object.keys(OBJECTIVE_LABEL) as Objective[])
                .filter(
                  (value) =>
                    value !== "whatsapp" || companyNiche === "food_service",
                )
                .map((value) => (
                  <button
                    key={value}
                    className={`rounded-xl border p-4 text-left ${
                      objective === value
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted/40"
                    }`}
                    onClick={() => setObjective(value)}
                    type="button"
                  >
                    <div className="font-semibold">{OBJECTIVE_LABEL[value]}</div>
                  </button>
                ))}
            </div>
            <Button disabled={isBusy} onClick={() => void scanAccount()}>
              Continuar
            </Button>
          </CardContent>
        </Card>
      )}

      {phase === "scanning" && (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Analisando o histórico da conta…
          </CardContent>
        </Card>
      )}

      {phase === "proven_ads" && (
        <Card>
          <CardHeader>
            <CardTitle>Anúncios validados para copiar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {provenAds.map((ad) => (
              <label key={ad.adId} className="flex items-start gap-3 rounded-lg border p-3">
                <input
                  checked={keepAdIds.includes(ad.adId)}
                  className="mt-1 size-4"
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setKeepAdIds((current) =>
                      checked
                        ? [...current, ad.adId]
                        : current.filter((id) => id !== ad.adId),
                    );
                  }}
                  type="checkbox"
                />
                <div className="min-w-0">
                  <p className="truncate font-medium">{ad.adName ?? ad.adId}</p>
                  <p className="text-xs text-muted-foreground">
                    Gasto {currency} {ad.spend.toFixed(2)}
                    {ad.roas != null ? ` · ROAS ${ad.roas.toFixed(2)}` : ""}
                  </p>
                </div>
              </label>
            ))}
            <Button
              disabled={keepAdIds.length === 0}
              onClick={() => setPhase("budget")}
            >
              Continuar
            </Button>
          </CardContent>
        </Card>
      )}

      {phase === "budget" && (
        <Card>
          <CardHeader>
            <CardTitle>Orçamento diário</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Valor por dia ({currency})</Label>
              <Input
                min={ADVISED_MIN_DAILY_BUDGET}
                onChange={(event) => setDailyBudget(event.target.value)}
                type="number"
                value={dailyBudget}
              />
              <div className="flex flex-wrap gap-2">
                {BUDGET_PRESETS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDailyBudget(value)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      dailyBudget === value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:border-primary/40",
                    )}
                  >
                    {currency} {value}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Recomendado a partir de {currency} {ADVISED_MIN_DAILY_BUDGET}.
              </p>
            </div>
            <Button onClick={goNextFromBudget}>Continuar</Button>
          </CardContent>
        </Card>
      )}

      {phase === "media" && (
        <Card>
          <CardHeader>
            <CardTitle>Mídia do anúncio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <MediaSourcePicker
              accountId={accountId}
              instagramBusinessAccountId={selectedPage?.instagramBusinessAccountId}
              maxSelection={MAX_MEDIAS}
              onChange={() => undefined}
              onChangeMany={setSelectedMedias}
              userId={userId}
            />
            {pendingVideos ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Enviando e processando o vídeo na Meta…
              </p>
            ) : null}
            <Button onClick={goNextFromMedia}>Continuar</Button>
          </CardContent>
        </Card>
      )}

      {phase === "text" && (
        <Card>
          <CardHeader>
            <CardTitle>Textos do anúncio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Oferta (para a IA)</Label>
              <Textarea
                onChange={(event) => setOffer(event.target.value)}
                placeholder="Ex.: rodízio de sushi por R$ 79 de terça a quinta"
                value={offer}
              />
              <Button
                disabled={isWritingCopy}
                onClick={() => void writeCopy()}
                type="button"
                variant="outline"
              >
                {isWritingCopy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Escrever com IA
              </Button>
            </div>
            <div className="space-y-2">
              <Label>Título</Label>
              <Input onChange={(event) => setHeadline(event.target.value)} value={headline} />
            </div>
            <div className="space-y-2">
              <Label>Texto</Label>
              <Textarea onChange={(event) => setMessage(event.target.value)} value={message} />
            </div>
            {objective !== "followers" && objective !== "whatsapp" ? (
              <div className="space-y-2">
                <Label>Link de destino</Label>
                <Input
                  onChange={(event) => setPromotionUrl(event.target.value)}
                  placeholder="https://"
                  value={promotionUrl}
                />
              </div>
            ) : null}
            <Button onClick={goNextFromText}>Continuar</Button>
          </CardContent>
        </Card>
      )}

      {phase === "location" && (
        <Card>
          <CardHeader>
            <CardTitle>Onde anunciar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <LocationTargetingSection
              accountId={accountId}
              company={companyProfile?.company ?? null}
              companyLocations={companyProfile?.locations ?? []}
              onLocationsChange={setManualLocations}
              selectedLocations={manualLocations}
              userId={userId}
            />
            <Button disabled={manualLocations.length === 0} onClick={goNextFromLocation}>
              Continuar
            </Button>
          </CardContent>
        </Card>
      )}

      {phase === "pixel" && (
        <Card>
          <CardHeader>
            <CardTitle>Pixel de conversão</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {pixels.length > 0 ? (
              <Select onValueChange={setPixelId} value={pixelId ?? undefined}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o pixel" />
                </SelectTrigger>
                <SelectContent>
                  {pixels.map((pixel) => (
                    <SelectItem key={pixel.id} value={pixel.id}>
                      {pixel.name || pixel.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhum pixel encontrado nesta conta. A campanha de vendas precisa de um pixel.
              </p>
            )}
            <Button disabled={needsPixel && !pixelId} onClick={() => void goToReview()}>
              Continuar
            </Button>
          </CardContent>
        </Card>
      )}

      {phase === "review" && (
        <Card>
          <CardHeader>
            <CardTitle>Revisar e publicar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Objetivo: {OBJECTIVE_LABEL[objective]} · Orçamento: {currency} {dailyBudget}/dia
              {hasMold ? " · A partir do histórico validado" : " · Campanha nova"}
              {` · ${selectedMedias.length} mídia(s)`}
            </p>

            {planIssues.length > 0 ? (
              <div className="space-y-2 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
                <p className="font-medium">A Meta pode recusar esta campanha</p>
                {planIssues.map((issue, index) => (
                  <p key={`${issue.reason ?? issue.message}-${index}`} className="text-muted-foreground">
                    {issue.reason ?? issue.message}
                    {issue.suggestion ? ` ${issue.suggestion}` : ""}
                  </p>
                ))}
              </div>
            ) : null}

            {selectedMedias.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {selectedMedias.map((media, index) => (
                    <div
                      key={
                        media.source === "instagram"
                          ? media.instagramMediaId
                          : media.source === "automatize_media"
                            ? media.generatedImageId
                            : media.blobUrl
                      }
                      className="overflow-hidden rounded-md border"
                    >
                      {media.previewUrl ? (
                        <img
                          alt={`Mídia ${index + 1}`}
                          className="aspect-square w-full object-cover"
                          src={media.previewUrl}
                        />
                      ) : (
                        <div className="flex aspect-square items-center justify-center text-xs text-muted-foreground">
                          Mídia {index + 1}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

              ) : null}

            <div className="space-y-2">
              <Label>Identidade</Label>
              <PageSelector
                isLoading={isLoadingPages}
                onSelectPage={(nextPageId) => {
                  setPageId(nextPageId);
                  if (mold) void refreshPlan({ pageId: nextPageId });
                }}
                pages={pages}
                selectedPageId={pageId}
              />
            </div>

            {objective === "whatsapp" ? (
              <WhatsappDestinationCard
                pageId={selectedPage?.pageId ?? pageId}
                pageName={selectedPage?.pageName}
                whatsappNumber={whatsappNumber}
                title="WhatsApp da campanha"
              >
                <div className="mt-4 space-y-3">
                  <div className="space-y-2">
                    <Label>Primeira mensagem do cliente</Label>
                    <Textarea
                      onChange={(event) =>
                        setWhatsappAutofillMessage(event.target.value)
                      }
                      placeholder="Oi! Vi o anúncio e quero saber mais."
                      rows={2}
                      value={whatsappAutofillMessage}
                    />
                    <p className="text-xs text-muted-foreground">
                      É o que já chega digitado no WhatsApp do cliente.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Saudação do negócio (opcional)</Label>
                    <Input
                      onChange={(event) => setWhatsappGreeting(event.target.value)}
                      placeholder="Olá! Como podemos te ajudar?"
                      value={whatsappGreeting}
                    />
                  </div>
                </div>
              </WhatsappDestinationCard>
            ) : null}

            {needsTexts ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Título</Label>
                  <Input onChange={(event) => setHeadline(event.target.value)} value={headline} />
                </div>
                <div className="space-y-2">
                  <Label>Botão (CTA)</Label>
                  <Select onValueChange={setCtaType} value={ctaType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CTA_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Texto</Label>
                  <Textarea onChange={(event) => setMessage(event.target.value)} value={message} />
                </div>
              </div>
            ) : null}

            {!hasMold ? (
              <div className="space-y-3">
                <Label>Período</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button className="justify-start gap-2" type="button" variant="outline">
                      <CalendarIcon className="size-4" />
                      {periodLabel}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <Calendar
                      defaultMonth={periodStart}
                      disabled={{ before: startOfDay(new Date()) }}
                      locale={ptBR}
                      mode="range"
                      onSelect={(range: DateRange | undefined) => {
                        if (range?.from) setPeriodStart(startOfDay(range.from));
                        if (range?.to) setPeriodEnd(startOfDay(range.to));
                      }}
                      selected={{ from: periodStart, to: periodEnd }}
                    />
                  </PopoverContent>
                </Popover>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Início
                    </Label>
                    <Select onValueChange={setPeriodStartTime} value={periodStartTime}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {HOUR_OPTIONS.map((time) => (
                          <SelectItem key={`start-${time}`} value={time}>
                            {time}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Término
                    </Label>
                    <Select onValueChange={setPeriodEndTime} value={periodEndTime}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {END_TIME_OPTIONS.map((time) => (
                          <SelectItem key={`end-${time}`} value={time}>
                            {time}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            ) : null}

            {!hasMold ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>Geo Localização</Label>
                  <Button onClick={openLocationStep} size="sm" type="button" variant="ghost">
                    Alterar
                  </Button>
                </div>
                {effectiveLocations.length > 0 ? (
                  <ul className="space-y-1 text-sm">
                    {effectiveLocations.map((location) => (
                      <li key={location.key} className="text-muted-foreground">
                        {location.name}
                        {location.address_string ? ` · ${location.address_string}` : ""}
                        {location.radius != null ? ` · ${location.radius} km` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-destructive">
                    Selecione ao menos uma localização para segmentação
                  </p>
                )}
              </div>
            ) : null}

            <AiPlacementsEditor
              mode={placementsMode}
              objective={objective}
              onChange={(nextPlacements) => {
                setSelectedPlacements(nextPlacements);
                if (mold) {
                  void refreshPlan({ selectedPlacements: nextPlacements });
                }
              }}
              onModeChange={(mode) => {
                setPlacementsMode(mode);
                if (mode === "manual" && selectedPlacements.length === 0) {
                  const nextPlacements =
                    objective === "followers"
                      ? [...INSTAGRAM_PLACEMENTS]
                      : [...ALL_PLACEMENTS];
                  setSelectedPlacements(nextPlacements);
                  if (mold) {
                    void refreshPlan({
                      placementsMode: mode,
                      selectedPlacements: nextPlacements,
                    });
                  }
                  return;
                }
                if (mold) {
                  void refreshPlan({
                    placementsMode: mode,
                    selectedPlacements,
                  });
                }
              }}
              selectedPlacements={selectedPlacements}
            />
            <p className="text-xs text-muted-foreground">
              {placementsSummary(placementsMode, selectedPlacements, objective)}
            </p>

            <AiDemographicLimitsEditor
              value={demographics}
              onChange={(next) => {
                setDemographics(next);
                if (mold) void refreshPlan({ demographics: next });
              }}
              disabled={isBusy}
            />
            <AiAudienceExclusionsEditor
              accountId={accountId}
              userId={userId}
              value={excludedCustomAudienceIds}
              onChange={(next) => {
                setExcludedCustomAudienceIds(next);
                if (mold) void refreshPlan({ excludedCustomAudienceIds: next });
              }}
              disabled={isBusy}
            />
            <AiAudienceInclusionsEditor
              accountId={accountId}
              userId={userId}
              value={includedCustomAudienceIds}
              onChange={(next) => {
                setIncludedCustomAudienceIds(next);
                if (mold) void refreshPlan({ includedCustomAudienceIds: next });
              }}
              disabled={isBusy}
            />
            {effectiveAudienceReview?.adSets?.length ? (
              <div className="space-y-3 rounded-md border p-3" aria-live="polite">
                <div>
                  <p className="font-medium">Segmentação efetiva por conjunto</p>
                  <p className="text-xs text-muted-foreground">
                    Valores aplicados substituem somente o campo correspondente; os demais permanecem herdados.
                  </p>
                </div>
                {effectiveAudienceReview.adSets.map((adSet) => (
                  <div key={adSet.index} className="rounded border p-3 text-sm">
                    <p className="font-medium">Conjunto {adSet.index + 1}</p>
                    <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                      <div>
                        <dt className="inline font-medium">Localização: </dt>
                        <dd className="inline">{audienceGeoLabel(adSet.geo)}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Expansão: </dt>
                        <dd className="inline">
                          {adSet.advantagePlus ? "ativada (Advantage+)" : "desativada"}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Públicos personalizados: </dt>
                        <dd className="inline">
                          {adSet.overlappingCustomAudiences > 0
                            ? `${adSet.customAudiences} selecionado(s); ${adSet.effectiveCustomAudiences} efetivo(s) após exclusões`
                            : adSet.customAudiences} ({adSet.includedCustomAudiencesApplied ? "aplicado" : "herdado"})
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Públicos excluídos: </dt>
                        <dd className="inline">
                          {adSet.overlappingCustomAudiences > 0
                            ? `${adSet.overlappingCustomAudiences} também incluído(s); a exclusão prevalece`
                            : adSet.excludedCustomAudiences} ({adSet.excludedCustomAudiencesApplied ? "aplicado" : "herdado"})
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Idade: </dt>
                        <dd className="inline">
                          {adSet.ageMin != null || adSet.ageMax != null
                            ? `${adSet.ageMin ?? 18}–${adSet.ageMax ?? 65}`
                            : "não especificada"}{" "}
                          ({adSet.ageSource})
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Gênero: </dt>
                        <dd className="inline">
                          {audienceGenderLabel(adSet.genders)} ({adSet.genderSource})
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Posicionamentos: </dt>
                        <dd className="inline">
                          {adSet.placements.automatic ? "automáticos (Advantage+)" : "manuais"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Configuração efetiva em todos os novos conjuntos: {mold
                ? plannedIncludedAudienceCount ?? includedCustomAudienceIds?.length ?? 0
                : includedCustomAudienceIds?.length ?? 0} inclusão(ões) e {mold
                ? plannedExcludedAudienceCount ?? excludedCustomAudienceIds?.length ?? 0
                : excludedCustomAudienceIds?.length ?? 0} exclusão(ões) de públicos.
              {includedCustomAudienceIds === undefined
                ? "O Advantage+ permanece no estado herdado."
                : includedCustomAudienceIds.length > 0
                  ? "O Advantage+ e a expansão de públicos estão desativados para respeitar as inclusões."
                  : "A lista de inclusões foi limpa; a expansão volta à composição da base."}
            </p>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium">Públicos da conta</p>
                <p className="text-sm text-muted-foreground">
                  Consulte ou gerencie a biblioteca sem alterar as respostas desta campanha.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={isBusy}
                onClick={() => setAudienceLibraryOpen(true)}
              >
                Gerenciar públicos
              </Button>
            </div>
            <AiAudienceLibraryDialog
              accountId={accountId}
              userId={userId}
              open={audienceLibraryOpen}
              onOpenChange={setAudienceLibraryOpen}
            />

            {showDeliverySchedule ? (
              <AdSetDeliveryScheduleEditor
                businessUnits={businessUnits}
                onChange={setDeliverySchedule}
                value={deliverySchedule}
              />
            ) : null}
            <Button
              disabled={
                isBusy ||
                planIssues.length > 0 ||
                pendingVideos ||
                planMedias.length === 0 ||
                (!hasMold && effectiveLocations.length === 0) ||
                (objective === "whatsapp" && !whatsappAutofillMessage.trim()) ||
                (objective === "whatsapp" && whatsappPageNotLinked)
              }
              onClick={() => void publish()}
            >
              Publicar campanha
            </Button>
          </CardContent>
        </Card>
      )}

      {phase === "publishing" && (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Publicando a campanha na Meta…
          </CardContent>
        </Card>
      )}
    </div>
  );
}
