"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  type PlanMedia,
} from "@/lib/meta-business/marketing/ai-creation/build-tree";
import type { MoldRef, ProvenAdRef } from "@/lib/meta-business/marketing/ai-creation";
import type { SelectedGeoLocation } from "@/lib/meta-business/geo-targeting-types";

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

type Objective = "sales" | "followers" | "leads";

type VideoUpload = {
  state: "uploading" | "processing" | "ready" | "error";
  videoId?: string;
  thumbnailUrl?: string;
};

const OBJECTIVE_LABEL: Record<Objective, string> = {
  sales: "Vendas",
  followers: "Seguidores",
  leads: "Leads",
};

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
  const [selectedMedia, setSelectedMedia] = useState<SelectedMedia | null>(null);
  const [videoUpload, setVideoUpload] = useState<VideoUpload | null>(null);
  const [headline, setHeadline] = useState("");
  const [message, setMessage] = useState("");
  const [offer, setOffer] = useState("");
  const [isWritingCopy, setIsWritingCopy] = useState(false);
  const [pageId, setPageId] = useState<string | null>(null);
  const [pixelId, setPixelId] = useState<string | null>(null);
  const [pixels, setPixels] = useState<Array<{ id: string; name?: string }>>([]);
  const [manualLocations, setManualLocations] = useState<SelectedGeoLocation[]>([]);
  const [promotionUrl, setPromotionUrl] = useState("");
  const [deliverySchedule, setDeliverySchedule] = useState<AdSetDeliveryScheduleValue>({
    deliveryMode: "specific_hours",
    scheduleBlocks: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const selectedPage = pages.find((page) => page.pageId === pageId) ?? pages[0] ?? null;
  const hasMold = Boolean(mold);
  const needsTexts = selectedMedia?.source !== "instagram";
  const needsPixel = objective === "sales" && !hasMold && !pixelId;
  const effectiveLocations = resolveEffectiveAiLocations(
    manualLocations,
    savedLocations,
  );
  const needsLocation = needsAiLocationStep(hasMold, effectiveLocations);

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
    if (
      selectedMedia?.source !== "device" ||
      selectedMedia.mediaType !== "video" ||
      !accountId ||
      !userId
    ) {
      return;
    }
    let cancelled = false;
    setVideoUpload({ state: "uploading" });
    fetch(apiPath(accountId, userId, "video"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl: selectedMedia.blobUrl }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message ?? "Falha ao enviar o vídeo.");
        }
        if (cancelled) return;
        setVideoUpload({
          state: "processing",
          videoId: data.videoId,
          thumbnailUrl: data.thumbnailUrl,
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setVideoUpload({ state: "error" });
          toast.error(err instanceof Error ? err.message : "Falha ao enviar o vídeo.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, userId, selectedMedia]);

  useEffect(() => {
    if (videoUpload?.state !== "processing" || !videoUpload.videoId) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      const res = await fetch(
        `${apiPath(accountId, userId, "video-status")}&videoIds=${videoUpload.videoId}`,
      );
      const data = await res.json();
      if (cancelled) return;
      const status = videoUpload.videoId
        ? data.data?.statuses?.[videoUpload.videoId]
        : undefined;
      if (status?.state === "ready") {
        setVideoUpload((prev) => (prev ? { ...prev, state: "ready" } : prev));
      }
      if (status?.state === "error") {
        setVideoUpload((prev) => (prev ? { ...prev, state: "error" } : prev));
      }
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [accountId, userId, videoUpload]);

  const planMedia = useMemo(
    () => (selectedMedia ? mediaToPlan(selectedMedia, videoUpload ?? undefined) : null),
    [selectedMedia, videoUpload],
  );

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

  async function scanAccount() {
    setIsBusy(true);
    setError(null);
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
      setMold(data.mold ?? null);
      setProvenAds(data.provenAds ?? []);
      setKeepAdIds((data.provenAds ?? []).map((ad: ProvenAdRef) => ad.adId));
      setPhase(data.mold ? "proven_ads" : "budget");
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
          objective: objective === "leads" ? "leads" : "sales",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message ?? "Não foi possível escrever o anúncio.");
      }
      setHeadline(data.headline);
      setMessage(data.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao gerar texto.");
    } finally {
      setIsWritingCopy(false);
    }
  }

  async function publish() {
    if (!planMedia) {
      toast.error("Selecione uma mídia pronta para publicar.");
      return;
    }
    if (!selectedPage) {
      toast.error("Selecione a página do anúncio.");
      return;
    }
    if (!hasMold && effectiveLocations.length === 0) {
      toast.error("Selecione ao menos uma localização para segmentação");
      return;
    }
    setIsBusy(true);
    setPhase("publishing");
    setError(null);
    try {
      const answers = {
        dailyBudget: Number(dailyBudget) || DEFAULT_DAILY_BUDGET,
        medias: [planMedia],
        texts: {
          headline,
          message,
          link: promotionUrl || undefined,
        },
        pageId: selectedPage.pageId,
        instagramUserId: selectedPage.instagramBusinessAccountId,
        pixelId: pixelId || undefined,
        keepAdIds: hasMold ? keepAdIds : undefined,
        deliveryMode: deliverySchedule.deliveryMode,
        scheduleBlocks:
          deliverySchedule.deliveryMode === "specific_hours"
            ? deliverySchedule.scheduleBlocks
            : [],
      };

      if (hasMold && mold) {
        const res = await fetch(apiPath(accountId, userId, "create"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mold, answers }),
        });
        const data = await res.json();
        if (!res.ok || !data.success || data.ok === false) {
          throw new Error(data.message ?? data.issues?.[0]?.message ?? "Falha ao criar.");
        }
      } else {
        const start = new Date();
        const stop = new Date(start.getTime() + DEFAULT_FLIGHT_DAYS * 86400000);
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
            period: {
              startTime: start.toISOString(),
              endTime: stop.toISOString(),
            },
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success || data.ok === false) {
          throw new Error(data.message ?? data.issues?.[0]?.message ?? "Falha ao criar.");
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
    setPhase("review");
  }

  function goNextFromMedia() {
    if (!selectedMedia) {
      toast.error("Escolha uma mídia.");
      return;
    }
    if (selectedMedia.source === "device" && selectedMedia.mediaType === "video") {
      if (videoUpload?.state !== "ready") {
        toast.error("Aguarde o vídeo ficar pronto na Meta.");
        return;
      }
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
    setPhase("review");
  }

  function openLocationStep() {
    if (manualLocations.length === 0 && savedLocations.length > 0) {
      setManualLocations(savedLocations);
    }
    setPhase("location");
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Button onClick={() => router.push(backHref)} size="icon" variant="ghost">
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Criar campanha com IA</h1>
          <p className="text-sm text-muted-foreground">
            Mesmos passos do app do cliente, na conta selecionada.
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
            <div className="grid gap-3 sm:grid-cols-3">
              {(Object.keys(OBJECTIVE_LABEL) as Objective[]).map((value) => (
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
              onChange={setSelectedMedia}
              userId={userId}
            />
            {videoUpload?.state === "uploading" || videoUpload?.state === "processing" ? (
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
            {objective !== "followers" ? (
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
            <Button disabled={needsPixel && !pixelId} onClick={() => setPhase("review")}>
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
            </p>
            <div className="space-y-2">
              <Label>Identidade</Label>
              <PageSelector
                isLoading={isLoadingPages}
                onSelectPage={setPageId}
                pages={pages}
                selectedPageId={pageId}
              />
            </div>
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
            <AdSetDeliveryScheduleEditor
              businessUnits={businessUnits}
              onChange={setDeliverySchedule}
              value={deliverySchedule}
            />
            <Button
              disabled={isBusy || (!hasMold && effectiveLocations.length === 0)}
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
