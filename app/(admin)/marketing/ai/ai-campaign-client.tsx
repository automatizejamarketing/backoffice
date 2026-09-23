"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { addDays, format, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft,
  CalendarIcon,
  Check,
  ChevronRight,
  ClipboardList,
  Info,
  Loader2,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Users,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { CampaignPublishError } from "./campaign-publish-error";
import { CreatePixelDialog } from "./create-pixel-dialog";
import { PixelInstallCard } from "./pixel-install-card";
import {
  isJustCreatedPixel,
  pixelStepState,
  suggestPixelName,
  type PixelOption,
} from "./pixel-step";
import { MediaSourcePicker, type SelectedMedia } from "../components/media-source-picker";
import { PageSelector } from "../components/page-selector";
import { usePages } from "../components/use-pages";
import { LocationTargetingSection } from "../components/location-targeting-section";
import { MetaAssetSelectionBadges } from "../components/meta-asset-selection-badges";
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
import { isValidPromotionLink, promotionLinkPolicy } from "./promotion-link";
import { usePageWhatsappNumber } from "../hooks/use-page-whatsapp-number";
import { AiAdvancedAudienceSheet } from "./ai-advanced-audience-sheet";
import {
  ReviewEffectiveAudience,
  ReviewInlineBlock,
  ReviewIssues,
  ReviewMediaStrip,
  ReviewMoldBanner,
  ReviewRow,
} from "./ai-review-card";
import {
  FlowHeader,
  FlowProgress,
  ReviewEditSheet,
  SelectionCard,
  StepActions,
  StepHeading,
  flowAccentCardClassName,
  flowBackButtonClassName,
  flowBodyClassName,
  flowBodyMediumClassName,
  flowCardClassName,
  flowCardDescriptionClassName,
  flowCardTitleClassName,
  flowErrorClassName,
  flowHintClassName,
  flowMonoCaptionClassName,
  flowNextButtonClassName,
  flowPageShellClassName,
  flowRowLabelClassName,
  flowSectionClassName,
  flowSelectionIdleClassName,
  flowSelectionItemClassName,
  flowSelectionSelectedClassName,
  flowWarningClassName,
} from "./flow-chrome";
import {
  TRAIL_STEP_LABEL,
  buildInboundTrail,
  trailStepForPhase,
  type Phase,
  type TrailStep,
} from "./flow-trail";
import { hasIdentityChoice, preselectIdentity } from "./identity-step";
import { scheduleSummary } from "./review-summaries";

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

type ReviewSheet = "link" | "period" | "schedule" | "location" | "placements" | "cta";

type PeriodDraft = {
  start: Date;
  end: Date;
  startTime: string;
  endTime: string;
};

const OBJECTIVE_OPTIONS: Array<{
  value: Objective;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: "sales",
    title: "Vendas no site",
    description: "Levar pessoas para comprar direto no site do cliente.",
    icon: ShoppingBag,
  },
  {
    value: "whatsapp",
    title: "Vendas no WhatsApp",
    description: "Levar pessoas para conversar no WhatsApp e fechar por lá.",
    icon: WhatsAppIcon,
  },
  {
    value: "followers",
    title: "Alcance e seguidores",
    description: "Alcance maior e mais seguidores no Instagram.",
    icon: Users,
  },
  {
    value: "leads",
    title: "Leads",
    description: "Coletar cadastros e mensagens de potenciais clientes.",
    icon: ClipboardList,
  },
];

const OBJECTIVE_LABEL: Record<Objective, string> = Object.fromEntries(
  OBJECTIVE_OPTIONS.map((option) => [option.value, option.title]),
) as Record<Objective, string>;

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

const CTA_LABEL: Record<(typeof CTA_OPTIONS)[number], string> = {
  LEARN_MORE: "Saiba mais",
  SHOP_NOW: "Comprar agora",
  ORDER_NOW: "Pedir agora",
  SEE_MENU: "Ver cardápio",
  GET_OFFER: "Ver oferta",
  SIGN_UP: "Cadastre-se",
  CONTACT_US: "Fale conosco",
  WHATSAPP_MESSAGE: "Enviar mensagem no WhatsApp",
  MESSAGE_PAGE: "Enviar mensagem",
  SUBSCRIBE: "Inscreva-se",
  DOWNLOAD: "Baixar",
  APPLY_NOW: "Inscreva-se agora",
  GET_QUOTE: "Pedir orçamento",
  BOOK_TRAVEL: "Reservar",
};

function ctaLabel(value: string): string {
  return (CTA_LABEL as Record<string, string>)[value] ?? value.replace(/_/g, " ");
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) =>
  `${hour.toString().padStart(2, "0")}:00`,
);
const END_TIME_OPTIONS = [...HOUR_OPTIONS, "23:59"];

function fallbackAcceptsSchedule(niche: string, objective: Objective): boolean {
  if (objective === "whatsapp") return true;
  if (objective !== "sales") return false;
  const normalized = niche === "service" ? "insurance_broker" : niche;
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

function getInitial(value?: string): string {
  if (!value || value.trim().length === 0) return "?";
  return value.trim().charAt(0).toUpperCase();
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

/** "R$" for the account's own currency; the ISO code for anything else. */
function currencySymbol(currency: string): string {
  return currency === "BRL" ? "R$" : currency;
}

export function AiCampaignClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const userId = searchParams.get("userId") ?? "";
  const accountId = searchParams.get("accountId") ?? "";
  /**
   * Inside the client drawer the flow runs in an iframe under `/embed`; every navigation must stay
   * there or the whole admin shell (sidebar, header) renders inside the drawer.
   */
  const embedded = pathname?.startsWith("/embed") ?? false;

  const { pages, isLoading: isLoadingPages } = usePages(accountId, userId, Boolean(accountId && userId));
  const { data: companyProfile, isPending: isLoadingCompanyProfile } = useCompanyProfile(userId);
  const businessUnits = useMemo(
    () => companyProfile?.locations ?? [],
    [companyProfile?.locations],
  );
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
  const [pixels, setPixels] = useState<PixelOption[]>([]);
  const [pixelsLoaded, setPixelsLoaded] = useState(false);
  const [pixelsError, setPixelsError] = useState<string | null>(null);
  const [pixelsReload, setPixelsReload] = useState(0);
  const [adAccountName, setAdAccountName] = useState<string | null>(null);
  const [createdPixelId, setCreatedPixelId] = useState<string | null>(null);
  const [createPixelOpen, setCreatePixelOpen] = useState(false);
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
  const [advancedAudienceOpen, setAdvancedAudienceOpen] = useState(false);
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

  /**
   * The media picker owns its selection. It is mounted the first time the media step opens and
   * kept mounted (hidden) from then on, so "Voltar" never drops what the operator already chose
   * and a device video keeps uploading while the next questions are answered.
   */
  const [mediaPickerMounted, setMediaPickerMounted] = useState(false);

  // Review-only editors: each sheet edits a draft; Salvar commits, anything else discards.
  const [reviewSheet, setReviewSheet] = useState<ReviewSheet | null>(null);
  const [sheetLink, setSheetLink] = useState("");
  const [sheetPeriod, setSheetPeriod] = useState<PeriodDraft | null>(null);
  const [sheetSchedule, setSheetSchedule] = useState<AdSetDeliveryScheduleValue | null>(null);
  const [sheetLocations, setSheetLocations] = useState<SelectedGeoLocation[]>([]);
  const [sheetPlacementsMode, setSheetPlacementsMode] = useState<PlacementsMode>("automatic");
  const [sheetSelectedPlacements, setSheetSelectedPlacements] = useState<PlacementKey[]>([]);
  const [sheetCtaType, setSheetCtaType] = useState<string>("LEARN_MORE");

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
  /**
   * The destination link is asked whatever the media is: an uploaded image, a video or a boosted
   * Instagram post all lead somewhere. Where it is asked depends on the media (text step vs. media
   * step); whether it blocks depends only on the objective.
   */
  const linkPolicy = promotionLinkPolicy(objective);
  const showsLink = linkPolicy !== "hidden";
  const linkValid = isValidPromotionLink(promotionUrl);
  const linkBlocks = linkPolicy === "required" && !linkValid;
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
  const identityChoice = hasIdentityChoice(pages);
  const showProvenAds = hasMold && provenAds.length > 0;
  const keptProvenAds = provenAds.filter((ad) => keepAdIds.includes(ad.adId));
  const budgetValue = Number(dailyBudget);
  const budgetBelowAdvice =
    Number.isFinite(budgetValue) && budgetValue > 0 && budgetValue < ADVISED_MIN_DAILY_BUDGET;

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

  const backHref = `${embedded ? "/embed" : ""}/users/${userId}?tab=marketing`;

  useEffect(() => {
    if (pages.length > 0 && !pageId) {
      setPageId(preselectIdentity(pages)?.pageId ?? pages[0].pageId);
    }
  }, [pages, pageId]);

  // With a single page there is nothing to ask: the step skips itself once the list is known.
  useEffect(() => {
    if (phase !== "identity" || isLoadingPages) return;
    if (!hasIdentityChoice(pages)) setPhase("media");
  }, [phase, isLoadingPages, pages]);

  useEffect(() => {
    if (phase === "media") setMediaPickerMounted(true);
  }, [phase]);

  // Every step is a screen of its own: a new one starts at the top, not where the last one ended.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [phase]);

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
    let cancelled = false;
    setPixelsLoaded(false);
    setPixelsError(null);
    fetch(`/api/meta-marketing/${accountId}/pixels?userId=${userId}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Never an empty string: pixelStepState reads the error by truthiness.
          throw new Error(
            typeof data?.message === "string" && data.message
              ? data.message
              : "Falha ao ler os pixels.",
          );
        }
        return data as { data?: PixelOption[]; accountName?: string | null };
      })
      .then((data) => {
        if (cancelled) return;
        const list = data.data ?? [];
        setPixels(list);
        setAdAccountName(data.accountName ?? null);
        // Functional update: re-reading the list must not undo a pixel already picked.
        setPixelId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPixels([]);
        setPixelsError((error instanceof Error && error.message) || "Falha ao ler os pixels.");
      })
      .finally(() => {
        if (!cancelled) setPixelsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, userId, pixelsReload]);

  const pixelStep = pixelStepState({
    loaded: pixelsLoaded,
    error: pixelsError,
    pixels,
    selectedPixelId: pixelId,
    createdPixelId,
  });

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
        {!embedded ? (
          <Button className="mt-4" onClick={() => router.push("/portfolio")} variant="outline">
            Voltar
          </Button>
        ) : null}
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

  /** The mold path asks Meta for the plan before the review opens; the fallback reviews locally. */
  async function goToReview() {
    if (hasMold) {
      setPhase("planning");
      await refreshPlan();
    }
    setPhase("review");
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
    setPhase(identityChoice || isLoadingPages ? "identity" : "media");
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
    // On the boost path the link field lives on this step, so it gates here.
    if (linkBlocks) {
      toast.error("Informe o link de destino do anúncio.");
      return;
    }
    advanceAfterCreative();
  }

  function goNextFromText() {
    if (needsTexts && (!headline.trim() || !message.trim())) {
      toast.error("Preencha título e texto do anúncio.");
      return;
    }
    if (linkBlocks) {
      toast.error("Informe o link de destino do anúncio.");
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

  function openLocationSheet() {
    // Pre-filled with the addresses currently in effect so the operator edits, not starts over.
    const seed =
      manualLocations.length === 0 && savedLocations.length > 0
        ? savedLocations
        : manualLocations;
    setSheetLocations(structuredClone(seed));
    setReviewSheet("location");
  }

  function openPeriodSheet() {
    setSheetPeriod({
      start: periodStart,
      end: periodEnd,
      startTime: periodStartTime,
      endTime: periodEndTime,
    });
    setReviewSheet("period");
  }

  function openScheduleSheet() {
    setSheetSchedule(structuredClone(deliverySchedule));
    setReviewSheet("schedule");
  }

  function openPlacementsSheet() {
    setSheetPlacementsMode(placementsMode);
    setSheetSelectedPlacements(
      selectedPlacements.length > 0
        ? selectedPlacements
        : objective === "followers"
          ? [...INSTAGRAM_PLACEMENTS]
          : [...ALL_PLACEMENTS],
    );
    setReviewSheet("placements");
  }

  function openCtaSheet() {
    setSheetCtaType(ctaType);
    setReviewSheet("cta");
  }

  function openLinkSheet() {
    setSheetLink(promotionUrl);
    setReviewSheet("link");
  }

  // ---- Trail -----------------------------------------------------------------------------------

  const inboundTrail = buildInboundTrail({
    hasIdentityChoice: identityChoice || phase === "identity",
    showProvenAds,
    needsTexts,
    // A step stays on the trail while the operator is on it, even once its answer stops being
    // needed (a location just picked, a pixel just chosen) — and joins it only once the data that
    // decides it has loaded, so the count does not jump on a cold page.
    needsLocationStep: (needsLocation && !isLoadingCompanyProfile) || phase === "location",
    needsPixelStep: (needsPixel && pixelsLoaded) || phase === "pixel",
  });
  const trailStep = trailStepForPhase(phase);
  const trailIndex = Math.max(0, inboundTrail.indexOf(trailStep));
  const progressLabel =
    phase === "scanning"
      ? "Analisando o histórico da conta…"
      : phase === "planning"
        ? "Montando a campanha…"
        : `Passo ${trailIndex + 1} de ${inboundTrail.length} · ${TRAIL_STEP_LABEL[trailStep]}`;

  /** The inbound step before `step`; the scan is never a destination, so it falls back to the objective. */
  function stepBefore(step: TrailStep): Phase {
    const index = inboundTrail.indexOf(step);
    const previous = inboundTrail[index - 1];
    if (!previous || previous === "scanning") return "objective";
    return previous;
  }

  // ---- Review -----------------------------------------------------------------------------------

  const periodLabel = `${format(periodStart, "dd/MM/yy")} ${periodStartTime} – ${format(periodEnd, "dd/MM/yy")} ${periodEndTime}`;
  const locationLabel =
    effectiveLocations.length > 0
      ? effectiveLocations
          .map(
            (location) =>
              `${location.name}${location.radius != null ? ` · ${location.radius} km` : ""}`,
          )
          .join(" · ")
      : "Nenhuma localização escolhida";
  const audienceAdjusted =
    demographics?.age != null ||
    demographics?.genders != null ||
    includedCustomAudienceIds !== undefined ||
    excludedCustomAudienceIds !== undefined;
  const scheduleEmpty =
    showDeliverySchedule &&
    deliverySchedule.deliveryMode === "specific_hours" &&
    deliverySchedule.scheduleBlocks.length === 0;
  const placementsEmpty = placementsMode === "manual" && selectedPlacements.length === 0;

  /** Why the button is off — or what it will do. Same slot either way. */
  const publishBlockedReason =
    phase === "publishing"
      ? "Publicando na Meta… isso leva alguns segundos."
      : planIssues.length > 0
        ? "Resolva as pendências apontadas pela Meta antes de publicar."
        : planMedias.length === 0
          ? "Escolha ao menos uma mídia pronta."
          : pendingVideos
            ? "Aguardando a Meta terminar de processar o vídeo."
            : !hasMold && effectiveLocations.length === 0
              ? "Selecione ao menos uma localização para segmentação."
              : linkBlocks
                ? "Informe o link de destino do anúncio."
                : objective === "whatsapp" && !whatsappAutofillMessage.trim()
                  ? "Escreva a primeira mensagem que o cliente verá no WhatsApp."
                  : objective === "whatsapp" && whatsappPageNotLinked
                    ? "Esta Página não tem número de WhatsApp vinculado."
                    : placementsEmpty
                      ? "Escolha ao menos um posicionamento."
                      : scheduleEmpty
                        ? "Escolha ao menos um horário de veiculação, ou use o dia todo."
                        : null;
  const publishDisabled = isBusy || publishBlockedReason !== null;

  const sheetLinkValid = isValidPromotionLink(sheetLink);
  const sheetLinkSaveDisabled =
    linkPolicy === "required" ? !sheetLinkValid : sheetLink.trim() !== "" && !sheetLinkValid;
  const sheetPeriodInvalid = sheetPeriod
    ? new Date(combineDateTime(sheetPeriod.end, sheetPeriod.endTime)) <=
      new Date(combineDateTime(sheetPeriod.start, sheetPeriod.startTime))
    : false;
  const sheetScheduleEmpty =
    sheetSchedule?.deliveryMode === "specific_hours" && sheetSchedule.scheduleBlocks.length === 0;
  const sheetPlacementsInvalid =
    sheetPlacementsMode === "manual" && sheetSelectedPlacements.length === 0;

  const moldBannerVisible =
    mold !== null &&
    phase !== "objective" &&
    phase !== "scanning" &&
    phase !== "proven_ads" &&
    phase !== "review" &&
    phase !== "publishing";

  const linkField = (id: string) => (
    <div className="space-y-2">
      <Label htmlFor={id}>
        Link de destino
        {linkPolicy === "required" ? <span className="text-destructive"> *</span> : null}
      </Label>
      <Input
        id={id}
        onChange={(event) => setPromotionUrl(event.target.value)}
        placeholder="https://"
        type="url"
        inputMode="url"
        value={promotionUrl}
        aria-invalid={Boolean(promotionUrl) && !linkValid}
      />
      {promotionUrl && !linkValid ? (
        <p className="text-xs text-destructive">
          Informe uma URL completa, começando com https://
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Para onde o botão do anúncio leva (site, cardápio, página da oferta).
        </p>
      )}
    </div>
  );

  return (
    <div className={flowPageShellClassName}>
      <Button
        variant="ghost"
        size="sm"
        className="mb-3 h-8 gap-1.5 px-2 text-xs text-muted-foreground"
        onClick={() => router.push(backHref)}
      >
        <ArrowLeft className="size-4" />
        Voltar para o cliente
      </Button>

      <FlowHeader
        title="Criar campanha com IA"
        subtitle="Tudo o que o cliente faz no app, na conta selecionada. Uma pergunta por vez; você aprova antes de publicar."
      />

      <FlowProgress
        currentIndex={trailIndex}
        total={inboundTrail.length}
        label={progressLabel}
      />

      {error ? (
        <div className="mt-6">
          <CampaignPublishError error={error} />
        </div>
      ) : null}

      {moldBannerVisible && mold ? <ReviewMoldBanner mold={mold} className="mt-6" /> : null}

      {/* Objective — the FIRST question, and the one that decides how the account is scanned. */}
      {phase === "objective" && (
        <section className={flowSectionClassName}>
          <StepHeading
            title="Qual é o objetivo?"
            description="Selecione o que o cliente quer alcançar com esta campanha."
          />
          {isLoadingCompanyProfile ? (
            // The publish payload needs the customer's niche. A missing profile
            // would otherwise be sent as "outros".
            <div className={cn("flex items-center gap-3", flowCardClassName)}>
              <Loader2 className="size-5 shrink-0 animate-spin text-primary" />
              <p className={cn("text-muted-foreground", flowBodyClassName)}>
                Carregando o perfil do cliente…
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {OBJECTIVE_OPTIONS.map((option) => (
                <SelectionCard
                  key={option.value}
                  icon={option.icon}
                  title={option.title}
                  description={option.description}
                  selected={objective === option.value}
                  onClick={() => setObjective(option.value)}
                  disabled={isBusy}
                />
              ))}
            </div>
          )}
          <StepActions>
            <Button
              className={flowNextButtonClassName}
              disabled={isBusy || isLoadingCompanyProfile}
              onClick={() => void scanAccount()}
            >
              Continuar
            </Button>
          </StepActions>
        </section>
      )}

      {(phase === "scanning" || phase === "planning") && (
        <div className={cn("mt-8 flex items-center gap-3", flowCardClassName)}>
          <Loader2 className="size-5 shrink-0 animate-spin text-primary" />
          <div className="space-y-0.5">
            <p className={flowCardTitleClassName}>
              {phase === "planning" ? "Montando a campanha…" : "Analisando o histórico da conta…"}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {phase === "planning"
                ? "Conferindo com a Meta o que vai ao ar antes de você revisar."
                : "Procurando anúncios validados para usar como base."}
            </p>
          </div>
        </div>
      )}

      {/* Proven ads picker — only when the scan found a mold. */}
      {phase === "proven_ads" && (
        <section className={flowSectionClassName}>
          <StepHeading
            title="Anúncios validados para copiar"
            description="A campanha nova parte destes anúncios. Desmarque os que não devem ser copiados."
          />
          <div className="space-y-2">
            {provenAds.map((ad) => {
              const checked = keepAdIds.includes(ad.adId);
              return (
                <button
                  key={ad.adId}
                  type="button"
                  onClick={() =>
                    setKeepAdIds((current) =>
                      checked
                        ? current.filter((id) => id !== ad.adId)
                        : [...current, ad.adId],
                    )
                  }
                  aria-pressed={checked}
                  className={cn(
                    flowSelectionItemClassName,
                    "flex w-full items-center gap-3",
                    checked ? flowSelectionSelectedClassName : flowSelectionIdleClassName,
                  )}
                >
                  {ad.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Meta CDN thumbnail
                    <img
                      src={ad.thumbnailUrl}
                      alt=""
                      className="size-14 shrink-0 rounded-md border border-border object-cover"
                    />
                  ) : (
                    <div className="flex size-14 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[10px] text-muted-foreground">
                      sem prévia
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate", flowBodyMediumClassName)}>
                      {ad.adName ?? ad.adId}
                    </p>
                    <p className={flowCardDescriptionClassName}>
                      {ad.kind === "validated" && ad.roas != null
                        ? `ROAS ${ad.roas.toFixed(1)}`
                        : ad.costPerResult != null
                          ? `${money(ad.costPerResult, currency)} / ${ad.resultLabel}`
                          : ad.resultLabel}
                      {` · Gasto ${money(ad.spend, currency)}`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-full border",
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border",
                    )}
                  >
                    {checked && <Check className="size-3" />}
                  </span>
                </button>
              );
            })}
          </div>
          {keepAdIds.length === 0 && (
            <p className={flowWarningClassName}>
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Mantenha ao menos um anúncio validado para continuar.
            </p>
          )}
          <StepActions
            back={
              <Button
                variant="outline"
                className={flowBackButtonClassName}
                onClick={() => setPhase("objective")}
              >
                Voltar
              </Button>
            }
          >
            <Button
              className={flowNextButtonClassName}
              disabled={keepAdIds.length === 0}
              onClick={() => setPhase("budget")}
            >
              Continuar
            </Button>
          </StepActions>
        </section>
      )}

      {/* Budget — always asked. */}
      {phase === "budget" && (
        <section className={flowSectionClassName}>
          <StepHeading
            title="Quanto investir por dia?"
            description="O orçamento diário da campanha. Você pode ajustar depois, na revisão."
          />
          <div className={cn("space-y-3", flowCardClassName)}>
            <Label htmlFor="ai-daily-budget" className="text-muted-foreground">
              Valor por dia ({currencySymbol(currency)})
            </Label>
            <div className="flex items-center gap-3 rounded-md border border-input bg-background px-4 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
              <span className="shrink-0 text-3xl font-semibold leading-none text-muted-foreground">
                {currencySymbol(currency)}
              </span>
              <Input
                id="ai-daily-budget"
                type="number"
                min={1}
                step={1}
                inputMode="decimal"
                value={dailyBudget}
                onChange={(event) => setDailyBudget(event.target.value)}
                className="h-16 border-0 bg-transparent px-0 text-3xl font-semibold leading-none tracking-tight shadow-none focus-visible:ring-0 md:text-3xl"
              />
            </div>
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
                      : "border-border bg-background hover:border-primary/40 hover:bg-primary/5",
                  )}
                >
                  {currencySymbol(currency)} {value}
                </button>
              ))}
            </div>
            {budgetBelowAdvice ? (
              // An advisory, never a block: the money is the client's.
              <p className={flowWarningClassName}>
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Recomendado a partir de {currencySymbol(currency)} {ADVISED_MIN_DAILY_BUDGET} por dia.
              </p>
            ) : (
              <p className={flowHintClassName}>
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Recomendado a partir de {currencySymbol(currency)} {ADVISED_MIN_DAILY_BUDGET} por dia.
              </p>
            )}
          </div>
          <StepActions
            back={
              <Button
                variant="outline"
                className={flowBackButtonClassName}
                onClick={() => setPhase(stepBefore("budget"))}
              >
                Voltar
              </Button>
            }
          >
            <Button
              className={flowNextButtonClassName}
              disabled={!Number.isFinite(budgetValue) || budgetValue <= 0}
              onClick={goNextFromBudget}
            >
              Continuar
            </Button>
          </StepActions>
        </section>
      )}

      {/* Identity — asked ONLY when the account really has a choice. */}
      {phase === "identity" && (
        <section className={flowSectionClassName}>
          <StepHeading
            title="Qual identidade assina o anúncio?"
            description="A Página e o Instagram que aparecem no anúncio. Os posts do Instagram vêm deste perfil."
          />
          {isLoadingPages ? (
            <div className={cn("flex items-center gap-3", flowCardClassName)}>
              <Loader2 className="size-5 shrink-0 animate-spin text-primary" />
              <p className={cn("text-muted-foreground", flowBodyClassName)}>
                Carregando as páginas do cliente…
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {pages.map((page) => {
                const selected = pageId === page.pageId;
                return (
                  <button
                    key={page.pageId}
                    type="button"
                    onClick={() => setPageId(page.pageId)}
                    aria-pressed={selected}
                    className={cn(
                      flowSelectionItemClassName,
                      "flex w-full items-center gap-3",
                      selected ? flowSelectionSelectedClassName : flowSelectionIdleClassName,
                    )}
                  >
                    <Avatar className="size-9 shrink-0">
                      <AvatarImage
                        src={page.instagramProfilePictureUrl ?? page.pagePictureUrl}
                        alt={page.pageName ?? page.pageId}
                      />
                      <AvatarFallback className="text-xs font-medium">
                        {getInitial(page.pageName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate", flowBodyMediumClassName)}>
                        {page.pageName ?? page.pageId}
                      </span>
                      <span className={cn("mt-0.5 block truncate", flowMonoCaptionClassName)}>
                        {page.instagramUsername
                          ? `@${page.instagramUsername}`
                          : "sem Instagram conectado"}
                      </span>
                      <span className="mt-1.5 block">
                        <MetaAssetSelectionBadges enabled={page.enabled} primary={page.primary} />
                      </span>
                    </span>
                    {selected && <Check className="size-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}
          <StepActions
            back={
              <Button
                variant="outline"
                className={flowBackButtonClassName}
                onClick={() => setPhase("budget")}
              >
                Voltar
              </Button>
            }
          >
            <Button
              className={flowNextButtonClassName}
              disabled={!pageId || isLoadingPages}
              onClick={() => setPhase("media")}
            >
              Continuar
            </Button>
          </StepActions>
        </section>
      )}

      {/* Media — mounted once reached, hidden afterwards (see `mediaPickerMounted`). */}
      {mediaPickerMounted && (
        <section className={cn(flowSectionClassName, phase !== "media" && "hidden")}>
          <StepHeading
            title={hasMold ? "Quer testar mídias novas também?" : "Qual mídia vai ao ar?"}
            description={
              hasMold
                ? "Os anúncios validados já entram. Cada mídia nova vira um anúncio no conjunto vencedor."
                : "Posts do Instagram, mídias do Automatize ou arquivos do computador. Todas as mídias entram no mesmo conjunto."
            }
          />
          <div className={flowCardClassName}>
            <MediaSourcePicker
              accountId={accountId}
              instagramBusinessAccountId={selectedPage?.instagramBusinessAccountId}
              maxSelection={MAX_MEDIAS}
              onChange={() => undefined}
              onChangeMany={setSelectedMedias}
              userId={userId}
            />
          </div>
          {pendingVideos ? (
            <p className={flowHintClassName}>
              <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
              Enviando e processando o vídeo na Meta…
            </p>
          ) : null}
          {/* A boosted post skips the text step, so the destination is asked right here — once
              there is a post to boost. */}
          {selectedMedias.length > 0 && !needsTexts && showsLink
            ? linkField("ai-link-boost")
            : null}
          <StepActions
            back={
              <Button
                variant="outline"
                className={flowBackButtonClassName}
                onClick={() => setPhase(stepBefore("media"))}
              >
                Voltar
              </Button>
            }
          >
            <Button
              className={flowNextButtonClassName}
              disabled={selectedMedias.length === 0}
              onClick={goNextFromMedia}
            >
              Continuar
            </Button>
          </StepActions>
        </section>
      )}

      {/* Texts — skipped entirely for an Instagram boost: the post IS the creative. */}
      {phase === "text" && (
        <section className={flowSectionClassName}>
          <StepHeading
            title="O que o anúncio diz?"
            description="Descreva a oferta e deixe a IA escrever. Os campos continuam editáveis."
          />
          <div className={cn("space-y-3", flowAccentCardClassName)}>
            <div className="space-y-2">
              <Label htmlFor="ai-offer" className="flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-primary" />
                Oferta (para a IA)
              </Label>
              <Textarea
                id="ai-offer"
                rows={2}
                onChange={(event) => setOffer(event.target.value)}
                placeholder="Ex.: rodízio de sushi por R$ 79 de terça a quinta"
                value={offer}
                disabled={isWritingCopy}
                className="bg-background"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={!offer.trim() || isWritingCopy}
              onClick={() => void writeCopy()}
            >
              {isWritingCopy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {isWritingCopy
                ? "Escrevendo…"
                : headline || message
                  ? "Escrever de novo com IA"
                  : "Escrever com IA"}
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-headline">Título</Label>
            <Input
              id="ai-headline"
              onChange={(event) => setHeadline(event.target.value)}
              value={headline}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-message">Texto</Label>
            <Textarea
              id="ai-message"
              rows={4}
              onChange={(event) => setMessage(event.target.value)}
              value={message}
            />
          </div>
          {showsLink ? linkField("ai-link") : null}
          {pendingVideos ? (
            <p className={flowHintClassName}>
              <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
              O vídeo ainda está sendo processado na Meta. Dá para continuar escrevendo.
            </p>
          ) : null}
          <StepActions
            back={
              <Button
                variant="outline"
                className={flowBackButtonClassName}
                onClick={() => setPhase("media")}
              >
                Voltar
              </Button>
            }
          >
            <Button
              className={flowNextButtonClassName}
              disabled={needsTexts && (!headline.trim() || !message.trim())}
              onClick={goNextFromText}
            >
              {needsLocation || needsPixel ? "Continuar" : "Revisar"}
            </Button>
          </StepActions>
        </section>
      )}

      {/* Location — asked ONLY when the business profile has no saved address. */}
      {phase === "location" && (
        <section className={flowSectionClassName}>
          <StepHeading
            title="Onde anunciar?"
            description="O cliente não tem endereço salvo. Escolha as localizações que a campanha alcança."
          />
          <div className={flowCardClassName}>
            <LocationTargetingSection
              accountId={accountId}
              company={companyProfile?.company ?? null}
              companyLocations={companyProfile?.locations ?? []}
              onLocationsChange={setManualLocations}
              selectedLocations={manualLocations}
              userId={userId}
            />
          </div>
          <StepActions
            back={
              <Button
                variant="outline"
                className={flowBackButtonClassName}
                onClick={() => setPhase(needsTexts ? "text" : "media")}
              >
                Voltar
              </Button>
            }
          >
            {/* No choice, no campaign: we never fall back to targeting the whole country. */}
            <Button
              className={flowNextButtonClassName}
              disabled={manualLocations.length === 0}
              onClick={goNextFromLocation}
            >
              {needsPixel ? "Continuar" : "Revisar"}
            </Button>
          </StepActions>
        </section>
      )}

      {/* Pixel — asked ONLY on a sales campaign without a base and without a pixel picked. */}
      {phase === "pixel" && (
        <section className={flowSectionClassName}>
          <StepHeading
            title={
              pixelStep.kind === "error"
                ? "Não conseguimos ler os pixels desta conta"
                : pixelStep.kind === "empty"
                  ? "Nenhum pixel na conta"
                  : "Qual pixel mede as vendas?"
            }
            description={
              pixelStep.kind === "loading"
                ? "Buscando os pixels da conta…"
                : pixelStep.kind === "error"
                  ? "Não dá para saber se a conta já tem um pixel — e criar outro por cima duplicaria. Tente de novo."
                  : pixelStep.kind === "empty"
                    ? "A campanha de vendas precisa de um pixel. Dá para criar um agora, na conta de anúncios do cliente."
                    : "O pixel de conversão que registra as compras desta campanha."
            }
          />
          {pixelStep.kind === "loading" ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
          ) : null}
          {pixelStep.kind === "error" ? (
            <div className="space-y-3">
              <p className={flowErrorClassName}>{pixelStep.message}</p>
              <Button variant="outline" onClick={() => setPixelsReload((n) => n + 1)}>
                Tentar de novo
              </Button>
            </div>
          ) : null}
          {pixelStep.kind === "empty" ? (
            <Button variant="outline" onClick={() => setCreatePixelOpen(true)}>
              Criar pixel na conta do cliente
            </Button>
          ) : null}
          {pixelStep.kind === "list" ? (
            <Select onValueChange={setPixelId} value={pixelId ?? undefined}>
              <SelectTrigger className="w-full">
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
          ) : null}
          {pixelStep.kind === "list" && pixelStep.justCreated && pixelId ? (
            <PixelInstallCard pixelId={pixelId} />
          ) : null}
          <StepActions
            back={
              <Button
                variant="outline"
                className={flowBackButtonClassName}
                onClick={() => setPhase(stepBefore("pixel"))}
              >
                Voltar
              </Button>
            }
          >
            <Button
              className={flowNextButtonClassName}
              disabled={needsPixel && !pixelId}
              onClick={() => void goToReview()}
            >
              Revisar
            </Button>
          </StepActions>
          <CreatePixelDialog
            open={createPixelOpen}
            onOpenChange={setCreatePixelOpen}
            accountId={accountId}
            userId={userId}
            defaultName={suggestPixelName(adAccountName, accountId)}
            onCreated={(pixel) => {
              setPixels((current) => [...current.filter((p) => p.id !== pixel.id), pixel]);
              setCreatedPixelId(pixel.id);
              setPixelId(pixel.id);
              toast.success("Pixel criado na conta do cliente.");
            }}
            onAlreadyExists={() => {
              toast.info("A conta já tinha um pixel. Relemos a lista e selecionamos ele.");
              setPixelsReload((n) => n + 1);
            }}
          />
        </section>
      )}

      {/* The review — everything that will go live, plus Meta's objections. THIS is the gate. */}
      {(phase === "review" || phase === "publishing") && (
        <section className={flowSectionClassName}>
          <StepHeading
            title="Revisar e publicar"
            description="Confira o que vai ao ar. A campanha sobe ativa na Meta assim que você aprovar."
          />

          {mold ? <ReviewMoldBanner mold={mold} /> : null}

          <ReviewIssues issues={planIssues} />

          <div className={cn("space-y-4", flowCardClassName)}>
            <div>
              <p className={flowCardTitleClassName}>Criativos</p>
              <p className={flowCardDescriptionClassName}>
                {keptProvenAds.length > 0
                  ? `${keptProvenAds.length} anúncio(s) validado(s) copiado(s)${selectedMedias.length > 0 ? ` e ${selectedMedias.length} mídia(s) nova(s)` : ""}.`
                  : `${selectedMedias.length} mídia(s) no mesmo conjunto.`}
              </p>
            </div>
            <ReviewMediaStrip provenAds={keptProvenAds} medias={selectedMedias} />

            <dl className="space-y-2.5">
              <ReviewRow label="Objetivo" value={OBJECTIVE_LABEL[objective]} />
              <ReviewRow
                label="Base"
                value={hasMold ? "Histórico validado da conta" : "Campanha nova"}
              />
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 pb-2.5">
                <dt className={flowRowLabelClassName}>Orçamento diário</dt>
                <dd className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{currencySymbol(currency)}</span>
                  <Input
                    aria-label="Orçamento diário"
                    type="number"
                    min={1}
                    step={1}
                    inputMode="decimal"
                    className="h-8 w-28 text-right"
                    value={dailyBudget}
                    disabled={phase === "publishing"}
                    onChange={(event) => setDailyBudget(event.target.value)}
                    // The mold path re-plans against Meta, so on BLUR only — per keystroke would
                    // burn the account's error-rate budget.
                    onBlur={() => {
                      if (mold) void refreshPlan({ dailyBudget });
                    }}
                  />
                  <span className="text-sm text-muted-foreground">/dia</span>
                </dd>
              </div>
              {needsTexts || showsLink ? (
                <ReviewRow
                  label="Botão (CTA)"
                  value={ctaLabel(ctaType)}
                  onEdit={openCtaSheet}
                  disabled={phase === "publishing"}
                />
              ) : null}
              {showsLink ? (
                <ReviewRow
                  label="Link de destino"
                  value={promotionUrl || "Não informado"}
                  onEdit={openLinkSheet}
                  disabled={phase === "publishing"}
                  invalid={linkBlocks || (Boolean(promotionUrl) && !linkValid)}
                />
              ) : null}
              {!hasMold ? (
                <ReviewRow
                  label="Período"
                  value={periodLabel}
                  onEdit={openPeriodSheet}
                  disabled={phase === "publishing"}
                />
              ) : null}
              {showDeliverySchedule ? (
                <ReviewRow
                  label="Horários"
                  value={scheduleSummary(deliverySchedule)}
                  onEdit={openScheduleSheet}
                  disabled={phase === "publishing"}
                  invalid={scheduleEmpty}
                />
              ) : null}
              {!hasMold ? (
                <ReviewRow
                  label="Localização"
                  value={locationLabel}
                  onEdit={openLocationSheet}
                  disabled={phase === "publishing"}
                  invalid={effectiveLocations.length === 0}
                />
              ) : null}
              <ReviewRow
                label="Posicionamentos"
                value={placementsSummary(placementsMode, selectedPlacements, objective)}
                onEdit={openPlacementsSheet}
                disabled={phase === "publishing"}
                invalid={placementsEmpty}
              />
            </dl>
          </div>

          <div className={cn("space-y-4", flowCardClassName)}>
            <ReviewInlineBlock
              label="Identidade"
              description="A Página e o Instagram que assinam o anúncio."
            >
              <PageSelector
                isLoading={isLoadingPages}
                disabled={phase === "publishing"}
                onSelectPage={(nextPageId) => {
                  setPageId(nextPageId);
                  if (mold) void refreshPlan({ pageId: nextPageId });
                }}
                pages={pages}
                selectedPageId={pageId}
              />
            </ReviewInlineBlock>

            {objective === "sales" ? (
              <ReviewInlineBlock
                label="Pixel de conversão"
                description="O pixel que registra as compras desta campanha."
              >
                {pixels.length > 0 ? (
                  <div className="space-y-3">
                    <Select
                      onValueChange={(next) => {
                        setPixelId(next);
                        if (mold) void refreshPlan({ pixelId: next });
                      }}
                      value={pixelId ?? undefined}
                      disabled={phase === "publishing"}
                    >
                      <SelectTrigger className="w-full">
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
                    {pixelId && isJustCreatedPixel(pixelId, createdPixelId) ? (
                      <PixelInstallCard pixelId={pixelId} />
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhum pixel encontrado nesta conta.
                  </p>
                )}
              </ReviewInlineBlock>
            ) : null}

            {objective === "whatsapp" ? (
              <ReviewInlineBlock label="WhatsApp da campanha">
                <WhatsappDestinationCard
                  pageId={selectedPage?.pageId ?? pageId}
                  pageName={selectedPage?.pageName}
                  whatsappNumber={whatsappNumber}
                >
                  <div className="mt-4 space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="ai-whatsapp-autofill">Primeira mensagem do cliente</Label>
                      <Textarea
                        id="ai-whatsapp-autofill"
                        onChange={(event) => setWhatsappAutofillMessage(event.target.value)}
                        placeholder="Oi! Vi o anúncio e quero saber mais."
                        rows={2}
                        value={whatsappAutofillMessage}
                        disabled={phase === "publishing"}
                      />
                      <p className="text-xs text-muted-foreground">
                        É o que já chega digitado no WhatsApp do cliente.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ai-whatsapp-greeting">Saudação do negócio (opcional)</Label>
                      <Input
                        id="ai-whatsapp-greeting"
                        onChange={(event) => setWhatsappGreeting(event.target.value)}
                        placeholder="Olá! Como podemos te ajudar?"
                        value={whatsappGreeting}
                        disabled={phase === "publishing"}
                      />
                    </div>
                  </div>
                </WhatsappDestinationCard>
              </ReviewInlineBlock>
            ) : null}

            {needsTexts ? (
              <ReviewInlineBlock
                label="Textos do anúncio"
                description="Editáveis até a publicação."
              >
                <div className="grid gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="ai-review-headline">Título</Label>
                    <Input
                      id="ai-review-headline"
                      onChange={(event) => setHeadline(event.target.value)}
                      value={headline}
                      disabled={phase === "publishing"}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ai-review-message">Texto</Label>
                    <Textarea
                      id="ai-review-message"
                      rows={4}
                      onChange={(event) => setMessage(event.target.value)}
                      value={message}
                      disabled={phase === "publishing"}
                    />
                  </div>
                </div>
              </ReviewInlineBlock>
            ) : null}
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={phase === "publishing"}
            onClick={() => setAdvancedAudienceOpen(true)}
            className="h-auto w-full justify-between gap-3 px-4 py-3 text-left"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                <SlidersHorizontal className="size-4" />
              </span>
              <span className="min-w-0 space-y-0.5">
                <span className="block text-sm font-semibold">
                  Configurações avançadas de público
                </span>
                <span className="block whitespace-normal text-xs font-normal text-muted-foreground">
                  Idade, gênero, inclusões, exclusões e biblioteca de públicos
                </span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {audienceAdjusted && (
                <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                  Ajustado
                </span>
              )}
              <ChevronRight className="size-4 text-muted-foreground" />
            </span>
          </Button>
          <p className={flowHintClassName} aria-live="polite">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Configuração efetiva em todos os novos conjuntos:{" "}
              {mold
                ? (plannedIncludedAudienceCount ?? includedCustomAudienceIds?.length ?? 0)
                : (includedCustomAudienceIds?.length ?? 0)}{" "}
              inclusão(ões) e{" "}
              {mold
                ? (plannedExcludedAudienceCount ?? excludedCustomAudienceIds?.length ?? 0)
                : (excludedCustomAudienceIds?.length ?? 0)}{" "}
              exclusão(ões) de públicos.{" "}
              {includedCustomAudienceIds === undefined
                ? "O Advantage+ permanece no estado herdado."
                : includedCustomAudienceIds.length > 0
                  ? "O Advantage+ e a expansão de públicos estão desativados para respeitar as inclusões."
                  : "A lista de inclusões foi limpa; a expansão volta à composição da base."}
            </span>
          </p>

          <ReviewEffectiveAudience audience={effectiveAudienceReview} />

          {pendingVideos ? (
            <p className={flowHintClassName}>
              <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
              O vídeo ainda está sendo processado na Meta. O botão libera quando terminar.
            </p>
          ) : null}

          <StepActions
            back={
              <Button
                variant="outline"
                className={flowBackButtonClassName}
                disabled={phase === "publishing"}
                onClick={() => setPhase(needsTexts ? "text" : "media")}
              >
                Voltar
              </Button>
            }
          >
            <Button
              className={flowNextButtonClassName}
              disabled={publishDisabled}
              onClick={() => void publish()}
            >
              {phase === "publishing" && <Loader2 className="size-4 animate-spin" />}
              {phase === "publishing" ? "Publicando…" : "Publicar campanha"}
            </Button>
          </StepActions>
          <p
            className={cn(
              "text-balance text-center text-xs leading-relaxed",
              publishBlockedReason && phase !== "publishing"
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {publishBlockedReason ?? "A campanha sobe ativa na Meta assim que você aprovar."}
          </p>
        </section>
      )}

      <AiAdvancedAudienceSheet
        open={advancedAudienceOpen}
        onOpenChange={setAdvancedAudienceOpen}
        accountId={accountId}
        userId={userId}
        demographics={demographics}
        onDemographicsChange={(next) => {
          setDemographics(next);
          if (mold) void refreshPlan({ demographics: next });
        }}
        includedCustomAudienceIds={includedCustomAudienceIds}
        onInclusionsChange={(next) => {
          setIncludedCustomAudienceIds(next);
          if (mold) void refreshPlan({ includedCustomAudienceIds: next });
        }}
        excludedCustomAudienceIds={excludedCustomAudienceIds}
        onExclusionsChange={(next) => {
          setExcludedCustomAudienceIds(next);
          if (mold) void refreshPlan({ excludedCustomAudienceIds: next });
        }}
        disabled={isBusy}
      />

      <ReviewEditSheet
        open={reviewSheet === "link"}
        title="Link de destino"
        description="Para onde o botão do anúncio leva. Cancelar descarta a alteração."
        saveDisabled={sheetLinkSaveDisabled}
        onOpenChange={(open) => !open && setReviewSheet(null)}
        onSave={() => {
          setPromotionUrl(sheetLink.trim());
          setReviewSheet(null);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="ai-review-link">
            Link de destino
            {linkPolicy === "required" ? <span className="text-destructive"> *</span> : null}
          </Label>
          <Input
            id="ai-review-link"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://"
            value={sheetLink}
            onChange={(event) => setSheetLink(event.target.value)}
            aria-invalid={Boolean(sheetLink.trim()) && !sheetLinkValid}
          />
          {sheetLink.trim() && !sheetLinkValid ? (
            <p className="text-xs text-destructive">
              Informe uma URL completa, começando com https://
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Site, cardápio ou página da oferta.
            </p>
          )}
        </div>
      </ReviewEditSheet>

      <ReviewEditSheet
        open={reviewSheet === "period"}
        title="Período da campanha"
        description="Quando a campanha começa e termina. Cancelar descarta a alteração."
        saveDisabled={!sheetPeriod || sheetPeriodInvalid}
        onOpenChange={(open) => !open && setReviewSheet(null)}
        onSave={() => {
          if (!sheetPeriod) return;
          setPeriodStart(sheetPeriod.start);
          setPeriodEnd(sheetPeriod.end);
          setPeriodStartTime(sheetPeriod.startTime);
          setPeriodEndTime(sheetPeriod.endTime);
          setReviewSheet(null);
        }}
      >
        {sheetPeriod ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Datas</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button className="w-full justify-start gap-2" type="button" variant="outline">
                    <CalendarIcon className="size-4" />
                    {format(sheetPeriod.start, "dd/MM/yy")} – {format(sheetPeriod.end, "dd/MM/yy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    defaultMonth={sheetPeriod.start}
                    disabled={{ before: startOfDay(new Date()) }}
                    locale={ptBR}
                    mode="range"
                    onSelect={(range: DateRange | undefined) => {
                      setSheetPeriod((current) =>
                        current
                          ? {
                              ...current,
                              start: range?.from ? startOfDay(range.from) : current.start,
                              end: range?.to ? startOfDay(range.to) : current.end,
                            }
                          : current,
                      );
                    }}
                    selected={{ from: sheetPeriod.start, to: sheetPeriod.end }}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className={flowRowLabelClassName}>Início</Label>
                <Select
                  onValueChange={(startTime) =>
                    setSheetPeriod((current) => (current ? { ...current, startTime } : current))
                  }
                  value={sheetPeriod.startTime}
                >
                  <SelectTrigger className="w-full">
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
                <Label className={flowRowLabelClassName}>Término</Label>
                <Select
                  onValueChange={(endTime) =>
                    setSheetPeriod((current) => (current ? { ...current, endTime } : current))
                  }
                  value={sheetPeriod.endTime}
                >
                  <SelectTrigger className="w-full">
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
            {sheetPeriodInvalid ? (
              <p className={flowErrorClassName}>
                <Info className="mt-0.5 size-3.5 shrink-0" />O término precisa vir depois do início.
              </p>
            ) : null}
          </div>
        ) : null}
      </ReviewEditSheet>

      <ReviewEditSheet
        open={reviewSheet === "schedule"}
        title="Horários de veiculação"
        description="Em quais dias e horários os anúncios rodam. Cancelar descarta a alteração."
        saveDisabled={!sheetSchedule || sheetScheduleEmpty}
        onOpenChange={(open) => !open && setReviewSheet(null)}
        onSave={() => {
          if (!sheetSchedule) return;
          setDeliverySchedule(sheetSchedule);
          setReviewSheet(null);
        }}
      >
        {sheetSchedule ? (
          <div className="space-y-3">
            <AdSetDeliveryScheduleEditor
              businessUnits={businessUnits}
              onChange={setSheetSchedule}
              value={sheetSchedule}
            />
            {sheetScheduleEmpty ? (
              <p className={flowErrorClassName}>
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Escolha ao menos um horário, ou use o dia todo.
              </p>
            ) : null}
          </div>
        ) : null}
      </ReviewEditSheet>

      <ReviewEditSheet
        open={reviewSheet === "location"}
        title="Localização"
        description="Onde a campanha alcança pessoas. Cancelar descarta a alteração."
        saveDisabled={sheetLocations.length === 0}
        onOpenChange={(open) => !open && setReviewSheet(null)}
        onSave={() => {
          setManualLocations(sheetLocations);
          setReviewSheet(null);
        }}
      >
        <LocationTargetingSection
          accountId={accountId}
          company={companyProfile?.company ?? null}
          companyLocations={companyProfile?.locations ?? []}
          onLocationsChange={setSheetLocations}
          selectedLocations={sheetLocations}
          userId={userId}
        />
      </ReviewEditSheet>

      <ReviewEditSheet
        open={reviewSheet === "placements"}
        title="Posicionamentos"
        description="Onde os anúncios aparecem. Cancelar descarta a alteração."
        saveDisabled={sheetPlacementsInvalid}
        onOpenChange={(open) => !open && setReviewSheet(null)}
        onSave={() => {
          setPlacementsMode(sheetPlacementsMode);
          setSelectedPlacements(sheetSelectedPlacements);
          setReviewSheet(null);
          if (mold) {
            void refreshPlan({
              placementsMode: sheetPlacementsMode,
              selectedPlacements: sheetSelectedPlacements,
            });
          }
        }}
      >
        <div className="space-y-3">
          <AiPlacementsEditor
            mode={sheetPlacementsMode}
            objective={objective}
            onChange={setSheetSelectedPlacements}
            onModeChange={(mode) => {
              setSheetPlacementsMode(mode);
              if (mode === "manual" && sheetSelectedPlacements.length === 0) {
                setSheetSelectedPlacements(
                  objective === "followers" ? [...INSTAGRAM_PLACEMENTS] : [...ALL_PLACEMENTS],
                );
              }
            }}
            selectedPlacements={sheetSelectedPlacements}
          />
          <p className="text-xs text-muted-foreground">
            {placementsSummary(sheetPlacementsMode, sheetSelectedPlacements, objective)}
          </p>
        </div>
      </ReviewEditSheet>

      <ReviewEditSheet
        open={reviewSheet === "cta"}
        title="Botão do anúncio"
        description="O texto do botão que leva ao destino. Cancelar descarta a alteração."
        onOpenChange={(open) => !open && setReviewSheet(null)}
        onSave={() => {
          setCtaType(sheetCtaType);
          setReviewSheet(null);
        }}
      >
        <div className="space-y-2">
          <Label>Botão (CTA)</Label>
          <Select onValueChange={setSheetCtaType} value={sheetCtaType}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CTA_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {ctaLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </ReviewEditSheet>
    </div>
  );
}
