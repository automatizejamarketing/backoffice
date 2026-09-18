"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Pencil, Sparkles, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  MoldRef,
  ProvenAdRef,
  ReviewSummary,
} from "@/lib/meta-business/marketing/ai-creation";
import { cn } from "@/lib/utils";
import type { SelectedMedia } from "../components/media-source-picker";
import {
  flowAccentCardClassName,
  flowBodyClassName,
  flowCardClassName,
  flowCardDescriptionClassName,
  flowCardTitleClassName,
  flowRowClassName,
  flowRowLabelClassName,
  flowRowValueClassName,
} from "./flow-chrome";

/**
 * Building blocks of the review: the flow composes them, so what is a row, what is inline and
 * what opens a sheet is decided in one place (the client), not spread across two files.
 */

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

/** What the campaign will be based on. Nothing is said when there is no mold. */
export function ReviewMoldBanner({ mold, className }: { mold: MoldRef; className?: string }) {
  const metric =
    mold.kind === "validated" && mold.metrics.roas != null
      ? ` · ROAS ${mold.metrics.roas.toFixed(1)}`
      : mold.metrics.costPerResult != null
        ? ` · ${money(mold.metrics.costPerResult, mold.metrics.currency)} / ${mold.metrics.resultLabel}`
        : "";
  return (
    <div className={cn(flowAccentCardClassName, className)}>
      <p className={cn("flex items-center gap-1.5 text-primary", flowRowLabelClassName)}>
        {mold.kind === "validated" ? (
          <Sparkles className="size-3.5" />
        ) : (
          <TrendingUp className="size-3.5" />
        )}
        {mold.kind === "validated"
          ? "Com base no anúncio validado"
          : "Com base no melhor anúncio da conta"}
      </p>
      <p className={cn("mt-1.5", flowBodyClassName)}>
        {mold.adName ?? mold.adId}
        {metric}
        {` · Gasto ${money(mold.metrics.spend, mold.metrics.currency)}`}
      </p>
    </div>
  );
}

/** Meta's objections to the plan. Publishing stays off while any is listed. */
export function ReviewIssues({
  issues,
}: {
  issues: Array<{ reason?: string; message?: string; suggestion?: string }>;
}) {
  if (issues.length === 0) return null;
  return (
    <div
      className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
      role="alert"
    >
      <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="size-4 shrink-0" />A Meta pode recusar esta campanha
      </p>
      {issues.map((issue, index) => (
        <p key={`${issue.reason ?? issue.message}-${index}`} className="text-muted-foreground">
          {issue.reason ?? issue.message}
          {issue.suggestion ? ` ${issue.suggestion}` : ""}
        </p>
      ))}
    </div>
  );
}

function mediaKey(media: SelectedMedia): string {
  return media.source === "instagram"
    ? media.instagramMediaId
    : media.source === "automatize_media"
      ? media.generatedImageId
      : media.blobUrl;
}

/** Proven ads the operator chose to duplicate, then the new media. */
export function ReviewMediaStrip({
  provenAds,
  medias,
}: {
  provenAds: ProvenAdRef[];
  medias: SelectedMedia[];
}) {
  if (provenAds.length === 0 && medias.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {provenAds.map((ad) => (
        <div key={ad.adId} className="w-20">
          {ad.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Meta CDN thumbnail
            <img
              src={ad.thumbnailUrl}
              alt=""
              className="size-20 rounded-lg border border-border object-cover"
            />
          ) : (
            <div className="flex size-20 items-center justify-center rounded-lg border border-border bg-muted p-1 text-center text-[10px] leading-tight text-muted-foreground">
              {ad.adName ?? ad.adId}
            </div>
          )}
          <p className="mt-1 truncate text-[10px] text-muted-foreground">{ad.adName ?? ad.adId}</p>
        </div>
      ))}
      {medias.map((media, index) => (
        <div key={mediaKey(media)} className="w-20">
          {media.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Blob/CDN url, not a static asset
            <img
              src={media.previewUrl}
              alt={`Mídia ${index + 1}`}
              className="size-20 rounded-lg border border-border object-cover"
            />
          ) : (
            <div className="flex size-20 items-center justify-center rounded-lg border border-border bg-muted p-1 text-center text-[10px] leading-tight text-muted-foreground">
              {media.source === "instagram" ? "Post do Instagram" : `Mídia ${index + 1}`}
            </div>
          )}
          <p className="mt-1 truncate text-[10px] text-muted-foreground">
            {media.source === "instagram"
              ? media.isVideo
                ? "Reel/vídeo"
                : "Post do Instagram"
              : media.source === "device" && media.mediaType === "video"
                ? "Vídeo"
                : "Imagem"}
          </p>
        </div>
      ))}
    </div>
  );
}

/** One line of the summary: label on the left, value on the right, "Editar" when it opens a sheet. */
export function ReviewRow({
  label,
  value,
  onEdit,
  disabled,
  invalid,
}: {
  label: string;
  value: ReactNode;
  onEdit?: () => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className={flowRowClassName}>
      <dt className={flowRowLabelClassName}>{label}</dt>
      <dd className="flex min-w-0 max-w-full items-start gap-2 sm:max-w-[70%]">
        <span
          className={cn(
            "min-w-0 text-right",
            flowRowValueClassName,
            invalid && "text-destructive",
          )}
        >
          {value}
        </span>
        {onEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="-my-0.5 shrink-0 text-muted-foreground"
            disabled={disabled}
            onClick={onEdit}
          >
            <Pencil className="size-3" />
            Editar
          </Button>
        ) : null}
      </dd>
    </div>
  );
}

/** A block of the summary that edits inline (identity, pixel, texts, WhatsApp). */
export function ReviewInlineBlock({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 border-b border-border/60 pb-4 last:border-0 last:pb-0">
      <div>
        <p className={flowRowLabelClassName}>{label}</p>
        {description ? <p className={flowCardDescriptionClassName}>{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

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
  return (
    [
      geo.customLocations ? `${geo.customLocations} endereço(s)` : "",
      geo.cities ? `${geo.cities} cidade(s)` : "",
      geo.regions ? `${geo.regions} região(ões)` : "",
      geo.countries ? `${geo.countries} país(es)` : "",
    ]
      .filter(Boolean)
      .join(" + ") || "não especificada"
  );
}

function audienceGenderLabel(genders: number[] | undefined): string {
  if (genders?.includes(1) && genders.includes(2)) return "homens e mulheres";
  if (genders?.includes(1)) return "homens";
  if (genders?.includes(2)) return "mulheres";
  return "não especificado";
}

/** What each new ad set will actually target — inherited from the base or applied here. */
export function ReviewEffectiveAudience({
  audience,
}: {
  audience: ReviewSummary["audience"] | undefined;
}) {
  if (!audience?.adSets?.length) return null;
  return (
    <div className={cn("space-y-3", flowCardClassName)} aria-live="polite">
      <div>
        <p className={flowCardTitleClassName}>Segmentação efetiva por conjunto</p>
        <p className={flowCardDescriptionClassName}>
          Valores aplicados substituem somente o campo correspondente; os demais permanecem
          herdados.
        </p>
      </div>
      {audience.adSets.map((adSet) => (
        <div key={adSet.index} className="rounded-md border p-3 text-sm">
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
                  : adSet.customAudiences}{" "}
                ({adSet.includedCustomAudiencesApplied ? "aplicado" : "herdado"})
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">Públicos excluídos: </dt>
              <dd className="inline">
                {adSet.overlappingCustomAudiences > 0
                  ? `${adSet.overlappingCustomAudiences} também incluído(s); a exclusão prevalece`
                  : adSet.excludedCustomAudiences}{" "}
                ({adSet.excludedCustomAudiencesApplied ? "aplicado" : "herdado"})
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
  );
}
