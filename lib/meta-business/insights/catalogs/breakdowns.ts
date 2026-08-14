/**
 * Supported breakdowns + compatibility rules.
 *
 * The full `breakdowns` enum was validated against the Marketing API v25.0
 * breakdowns docs. We expose a curated subset relevant to ad analytics, plus the
 * documented incompatibility rules, so the agent avoids invalid combinations
 * (design §6: breakdown matrix; system-prompt rule about valid combos).
 *
 * Documented rules captured here (v25.0):
 * - Hourly breakdowns are incompatible with reach/frequency/unique fields
 *   (those return 0 when an hourly breakdown is used).
 * - Video percentile fields (video_pXX_watched_actions) and
 *   video_avg_time_watched_actions are NOT supported with the `region` breakdown.
 * - Combining many heavy geo/time breakdowns at once tends to error; we cap and
 *   reject the riskiest combinations up front.
 */

export const SUPPORTED_BREAKDOWNS = [
  "age",
  "gender",
  "country",
  "region",
  "dma",
  "publisher_platform",
  "platform_position",
  "impression_device",
  "device_platform",
  "hourly_stats_aggregated_by_advertiser_time_zone",
  "hourly_stats_aggregated_by_audience_time_zone",
] as const;

export type SupportedBreakdown = (typeof SUPPORTED_BREAKDOWNS)[number];

export const BREAKDOWN_LABELS_PT: Record<SupportedBreakdown, string> = {
  age: "Idade",
  gender: "Gênero",
  country: "País",
  region: "Região",
  dma: "Região metropolitana (DMA)",
  publisher_platform: "Plataforma",
  platform_position: "Posicionamento",
  impression_device: "Dispositivo de impressão",
  device_platform: "Plataforma do dispositivo",
  hourly_stats_aggregated_by_advertiser_time_zone: "Hora (fuso do anunciante)",
  hourly_stats_aggregated_by_audience_time_zone: "Hora (fuso da audiência)",
};

const SUPPORTED_SET = new Set<string>(SUPPORTED_BREAKDOWNS);

const HOURLY_BREAKDOWNS = new Set<string>([
  "hourly_stats_aggregated_by_advertiser_time_zone",
  "hourly_stats_aggregated_by_audience_time_zone",
]);

/** Fields that return 0 / are unreliable under an hourly breakdown. */
const HOURLY_INCOMPATIBLE_FIELDS = new Set<string>([
  "reach",
  "frequency",
  "cpp",
]);

/** Video fields not supported with the `region` breakdown. */
const REGION_INCOMPATIBLE_FIELDS = new Set<string>([
  "video_avg_time_watched_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
  "video_thruplay_watched_actions",
]);

/** Heavy geo/time breakdowns that shouldn't be combined with each other. */
const HEAVY_BREAKDOWNS = new Set<string>([
  "region",
  "country",
  "dma",
  "hourly_stats_aggregated_by_advertiser_time_zone",
  "hourly_stats_aggregated_by_audience_time_zone",
]);

const MAX_BREAKDOWNS = 3;

export type BreakdownValidation = {
  valid: SupportedBreakdown[];
  rejected: string[];
  /** Non-fatal notes the agent should relay (e.g. "alcance não é confiável por hora"). */
  warnings: string[];
};

/**
 * Validate a requested breakdown combination against the requested metric fields.
 * Rejects unknown/over-large/known-bad combos; warns on lossy-but-allowed ones.
 */
export function validateBreakdowns(
  breakdowns: string[] | undefined,
  fields: string[] = [],
): BreakdownValidation {
  const result: BreakdownValidation = { valid: [], rejected: [], warnings: [] };
  if (!breakdowns?.length) return result;

  const seen = new Set<string>();
  for (const b of breakdowns) {
    if (!SUPPORTED_SET.has(b)) {
      result.rejected.push(b);
      continue;
    }
    if (seen.has(b)) continue;
    seen.add(b);
    result.valid.push(b as SupportedBreakdown);
  }

  if (result.valid.length > MAX_BREAKDOWNS) {
    // Keep the first N, reject the rest — too many breakdowns errors at Meta.
    const overflow = result.valid.splice(MAX_BREAKDOWNS);
    result.rejected.push(...overflow);
    result.warnings.push(
      `Mais de ${MAX_BREAKDOWNS} recortes simultâneos não são suportados; usei os primeiros ${MAX_BREAKDOWNS}.`,
    );
  }

  const heavy = result.valid.filter((b) => HEAVY_BREAKDOWNS.has(b));
  if (heavy.length > 1) {
    // Keep the first heavy breakdown, drop the others.
    const drop = heavy.slice(1);
    result.valid = result.valid.filter((b) => !drop.includes(b));
    result.rejected.push(...drop);
    result.warnings.push(
      "Recortes pesados de geografia/horário não podem ser combinados; mantive apenas um.",
    );
  }

  const hasHourly = result.valid.some((b) => HOURLY_BREAKDOWNS.has(b));
  if (hasHourly && fields.some((f) => HOURLY_INCOMPATIBLE_FIELDS.has(f))) {
    result.warnings.push(
      "Com recorte por hora, alcance/frequência não são confiáveis (a Meta retorna 0).",
    );
  }

  const hasRegion = result.valid.includes("region");
  if (hasRegion && fields.some((f) => REGION_INCOMPATIBLE_FIELDS.has(f))) {
    result.warnings.push(
      "Métricas de vídeo não são suportadas no recorte por região; elas virão vazias.",
    );
  }

  return result;
}
