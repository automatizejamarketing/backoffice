import {
  creativeSkipReasonLabel,
  normalizeCreativeErrorCode,
} from "@/lib/creative-analysis/labels";

export const CREATIVE_ANALYSIS_LIMITS = [1, 3, 5, "all"] as const;

export type CreativeAnalysisLimit =
  (typeof CREATIVE_ANALYSIS_LIMITS)[number];

export type CreativeAnalysisPlaygroundRequest = {
  action: "preview" | "run";
  scope: "eligible" | "ad";
  limit: CreativeAnalysisLimit;
  adId?: string;
  force: boolean;
};

export type CreativeAnalysisBucket =
  | "positive"
  | "negative"
  | "pending"
  | "skipped"
  | "control"
  | "failed";

export type CreativeAnalysisMetricComparison = {
  window: string;
  metric: string;
  candidate: number | null;
  siblings: number | null;
  deltaPercent: number | null;
};

export type CreativeAnalysisCraftGap = {
  dimension: string;
  finding: string;
  suggestion: string;
};

export type CreativeAnalysisMedia = {
  type: "image" | "video";
  order: number;
  url: string;
};

export type CreativeAnalysisMediaKind = "image" | "video" | "unknown";

export type CreativeAnalysisRow = {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  accountId: string;
  adId: string;
  creativeId: string;
  campaignId: string | null;
  adsetId: string | null;
  rankingDate: string | null;
  rubricVersion: string;
  modelId: string;
  metricWindowStart: string;
  metricWindowEnd: string;
  status: string;
  confidence: string | null;
  likelyContributor: boolean | null;
  errorMessage: string | null;
  evidence: unknown;
  diagnosis: unknown;
  media: CreativeAnalysisMedia[];
  mediaKind: CreativeAnalysisMediaKind;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type CreativeAnalysisView = Omit<
  CreativeAnalysisRow,
  "evidence" | "diagnosis" | "createdAt" | "updatedAt"
> & {
  bucket: CreativeAnalysisBucket;
  summary: string | null;
  evidenceGaps: string[];
  citations: string[];
  craftGaps: CreativeAnalysisCraftGap[];
  alternativeExplanations: string[];
  metricComparisons: CreativeAnalysisMetricComparison[];
  siblingCount: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CreativeAnalysisSummary = {
  total: number;
  analyzed: number;
  positive: number;
  negative: number;
  pending: number;
  skipped: number;
  control: number;
  failed: number;
};

export class CreativeAnalysisRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreativeAnalysisRequestError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function safeUpstreamError(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 240 || /^https?:/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function describePlaygroundUpstreamFailure(input: {
  status: number;
  body: unknown;
}): string {
  const record = asRecord(input.body);
  const upstream = safeUpstreamError(record?.error);
  const status = input.status;

  if (status === 401) {
    return upstream
      ? `O frontend recusou a autenticação (${status}): ${upstream}`
      : `O frontend recusou a autenticação (${status}). Confira se FRONTEND_CRON_SECRET do backoffice bate com CRON_SECRET do frontend.`;
  }
  if (status === 403) {
    return "O playground está bloqueado neste ambiente (CREATIVE_ANALYSIS_PLAYGROUND_ENABLED).";
  }
  if (status === 409) {
    if (upstream?.includes("DELIVERY")) {
      return `A entrega ao cliente está ligada — desligue CREATIVE_ANALYSIS_DELIVERY_ENABLED para usar o playground (${status}).`;
    }
    if (upstream?.toLowerCase().includes("disabled")) {
      return `A análise está desligada neste ambiente (${status}): ${upstream}`;
    }
    return upstream
      ? `O frontend recusou a execução (${status}): ${upstream}`
      : `O frontend recusou a execução (${status}).`;
  }
  if (status === 404) {
    return upstream
      ? `Anúncio não encontrado no tracking (${status}): ${upstream}`
      : `Anúncio não encontrado no tracking (${status}).`;
  }
  if (status === 400) {
    return upstream
      ? `Pedido inválido (${status}): ${upstream}`
      : `Pedido inválido (${status}).`;
  }
  return upstream
    ? `O frontend recusou a solicitação (${status}): ${upstream}`
    : `O frontend recusou a solicitação (${status}).`;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim() !== "",
  );
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value.trim())) {
    return null;
  }
  return value.trim();
}

export function previewFromCreativeSpec(
  spec: unknown,
): CreativeAnalysisMedia[] {
  const record = asRecord(spec);
  if (!record) return [];
  const story = asRecord(record.object_story_spec);
  const video = asRecord(story?.video_data);
  const link = asRecord(story?.link_data);
  const asset = asRecord(record.asset_feed_spec);
  const media: CreativeAnalysisMedia[] = [];
  const push = (type: CreativeAnalysisMedia["type"], url: string | null) => {
    if (!url || media.some((item) => item.url === url)) return;
    media.push({ type, order: media.length, url });
  };
  push("image", httpUrl(record.thumbnail_url));
  push("image", httpUrl(record.image_url));
  push("image", httpUrl(video?.image_url));
  push("image", httpUrl(link?.picture));
  if (Array.isArray(asset?.images)) {
    for (const image of asset.images) {
      push("image", httpUrl(asRecord(image)?.url));
    }
  }
  if (Array.isArray(link?.child_attachments)) {
    for (const child of link.child_attachments) {
      push("image", httpUrl(asRecord(child)?.picture));
    }
  }
  return media.slice(0, 4);
}

export function creativeSpecMediaKind(
  spec: unknown,
): CreativeAnalysisMediaKind {
  const record = asRecord(spec);
  if (!record) return "unknown";
  const story = asRecord(record.object_story_spec);
  const video = asRecord(story?.video_data);
  const asset = asRecord(record.asset_feed_spec);
  const objectType =
    typeof record.object_type === "string" ? record.object_type : "";
  if (
    typeof record.video_id === "string" ||
    typeof video?.video_id === "string" ||
    /video/i.test(objectType) ||
    (Array.isArray(asset?.videos) && asset.videos.length > 0)
  ) {
    return "video";
  }
  if (previewFromCreativeSpec(record).length > 0) return "image";
  return "unknown";
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function safeErrorMessage(value: string | null): string | null {
  if (!value) return null;
  return normalizeCreativeErrorCode(value);
}

export function parseCreativeAnalysisRequest(
  value: unknown,
): CreativeAnalysisPlaygroundRequest {
  const body = asRecord(value);
  if (!body) {
    throw new CreativeAnalysisRequestError("Corpo JSON inválido.");
  }

  const allowedKeys = new Set([
    "action",
    "scope",
    "limit",
    "adId",
    "force",
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new CreativeAnalysisRequestError(
      "O corpo contém campos não permitidos.",
    );
  }

  if (body.action !== "preview" && body.action !== "run") {
    throw new CreativeAnalysisRequestError(
      "action deve ser preview ou run.",
    );
  }
  if (body.scope !== "eligible" && body.scope !== "ad") {
    throw new CreativeAnalysisRequestError(
      "scope deve ser eligible ou ad.",
    );
  }
  if (
    !CREATIVE_ANALYSIS_LIMITS.includes(
      body.limit as (typeof CREATIVE_ANALYSIS_LIMITS)[number],
    )
  ) {
    throw new CreativeAnalysisRequestError("limit deve ser 1, 3, 5 ou all.");
  }
  if (body.force !== undefined && typeof body.force !== "boolean") {
    throw new CreativeAnalysisRequestError("force deve ser booleano.");
  }

  const adId =
    typeof body.adId === "string" && body.adId.trim()
      ? body.adId.trim()
      : undefined;
  const force = body.force === true;

  if (body.scope === "ad" && !adId) {
    throw new CreativeAnalysisRequestError(
      "adId é obrigatório para o escopo ad.",
    );
  }
  if (body.scope === "eligible" && body.adId !== undefined) {
    throw new CreativeAnalysisRequestError(
      "adId só é permitido para o escopo ad.",
    );
  }
  if (body.scope !== "ad" && body.force !== undefined) {
    throw new CreativeAnalysisRequestError(
      "force só é permitido para o escopo ad.",
    );
  }

  return {
    action: body.action,
    scope: body.scope,
    limit: body.limit as CreativeAnalysisLimit,
    adId,
    force,
  };
}

export function bucketCreativeAnalysis(
  row: Pick<
    CreativeAnalysisRow,
    "status" | "likelyContributor" | "errorMessage" | "evidence"
  >,
): CreativeAnalysisBucket {
  const evidence = asRecord(row.evidence);
  if (
    row.status === "skipped" &&
    (row.errorMessage === "forced_control" ||
      evidence?.forcedControl === true)
  ) {
    return "control";
  }
  if (row.status === "pending") return "pending";
  if (row.status === "failed") return "failed";
  if (row.status === "skipped") return "skipped";
  if (row.status === "ready" && row.likelyContributor === true) {
    return "positive";
  }
  if (row.status === "ready" && row.likelyContributor === false) {
    return "negative";
  }
  return "skipped";
}

const METRIC_KEYS = [
  "ctr",
  "threeSecondViewRate",
  "p25ViewRate",
  "landingPageRate",
  "cpa",
  "roas",
  "avgWatchSeconds",
] as const;

function metricComparisons(
  evidence: Record<string, unknown> | null,
): CreativeAnalysisMetricComparison[] {
  const windows = asRecord(evidence?.windows);
  const candidateWindows = asRecord(windows?.candidate);
  const siblingWindows = asRecord(windows?.siblings);
  if (!candidateWindows && !siblingWindows) return [];

  const names = new Set([
    ...Object.keys(candidateWindows ?? {}),
    ...Object.keys(siblingWindows ?? {}),
  ]);
  const orderedNames = ["7d", "14d", "28d"].filter((name) => names.has(name));
  for (const name of names) {
    if (!orderedNames.includes(name)) orderedNames.push(name);
  }

  return orderedNames.flatMap((window) => {
    const candidate = asRecord(candidateWindows?.[window]);
    const siblings = asRecord(siblingWindows?.[window]);
    return METRIC_KEYS.flatMap((metric) => {
      const candidateValue = asFiniteNumber(candidate?.[metric]);
      const siblingValue = asFiniteNumber(siblings?.[metric]);
      if (candidateValue === null && siblingValue === null) return [];
      const deltaPercent =
        candidateValue !== null && siblingValue !== null && siblingValue !== 0
          ? ((candidateValue - siblingValue) / Math.abs(siblingValue)) * 100
          : null;
      return [
        {
          window,
          metric,
          candidate: candidateValue,
          siblings: siblingValue,
          deltaPercent,
        },
      ];
    });
  });
}

function craftGaps(value: unknown): CreativeAnalysisCraftGap[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const gap = asRecord(item);
    if (
      typeof gap?.dimension !== "string" ||
      typeof gap.finding !== "string" ||
      typeof gap.suggestion !== "string"
    ) {
      return [];
    }
    return [
      {
        dimension: gap.dimension,
        finding: gap.finding,
        suggestion: gap.suggestion,
      },
    ];
  });
}

export function buildCreativeAnalysisView(
  row: CreativeAnalysisRow,
): CreativeAnalysisView {
  const diagnosis = asRecord(row.diagnosis);
  const evidence = asRecord(row.evidence);
  const {
    evidence: _evidence,
    diagnosis: _diagnosis,
    createdAt,
    updatedAt,
    ...identity
  } = row;
  void _evidence;
  void _diagnosis;
  return {
    ...identity,
    media: Array.isArray(row.media) ? row.media : [],
    mediaKind:
      row.mediaKind === "video" ||
      row.media?.some((item) => item.type === "video")
        ? "video"
        : row.mediaKind === "image" || (row.media?.length ?? 0) > 0
          ? "image"
          : "unknown",
    errorMessage: safeErrorMessage(row.errorMessage),
    bucket: bucketCreativeAnalysis(row),
    summary:
      typeof diagnosis?.summary === "string" ? diagnosis.summary : null,
    evidenceGaps: asStringArray(evidence?.gaps),
    citations: asStringArray(diagnosis?.citations),
    craftGaps: craftGaps(diagnosis?.craftGaps),
    alternativeExplanations: asStringArray(
      diagnosis?.alternativeExplanations,
    ),
    metricComparisons: metricComparisons(evidence),
    siblingCount: asFiniteNumber(evidence?.siblingCount),
    createdAt: toIso(createdAt),
    updatedAt: toIso(updatedAt),
  };
}

export function summarizeCreativeAnalyses(
  rows: CreativeAnalysisRow[],
): { records: CreativeAnalysisView[]; summary: CreativeAnalysisSummary } {
  const records = rows.map(buildCreativeAnalysisView);
  const count = (bucket: CreativeAnalysisBucket) =>
    records.filter((record) => record.bucket === bucket).length;
  const positive = count("positive");
  const negative = count("negative");

  return {
    records,
    summary: {
      total: records.length,
      analyzed: positive + negative,
      positive,
      negative,
      pending: count("pending"),
      skipped: count("skipped"),
      control: count("control"),
      failed: count("failed"),
    },
  };
}

export type CreativeAnalysisListFilters = {
  bucket: CreativeAnalysisBucket | "all";
  showSkipped: boolean;
  confidence: string;
  query: string;
};

export function filterCreativeAnalysisViews(
  records: CreativeAnalysisView[],
  filters: CreativeAnalysisListFilters,
): CreativeAnalysisView[] {
  const normalizedQuery = filters.query.trim().toLowerCase();
  return records.filter((record) => {
    if (filters.bucket !== "all" && record.bucket !== filters.bucket) {
      return false;
    }
    if (
      filters.bucket === "all" &&
      !filters.showSkipped &&
      record.bucket === "skipped"
    ) {
      return false;
    }
    if (
      filters.confidence !== "all" &&
      record.confidence !== filters.confidence
    ) {
      return false;
    }
    if (!normalizedQuery) return true;
    return [
      record.adId,
      record.accountId,
      record.userName,
      record.userEmail,
      record.userId,
      record.campaignId,
      record.errorMessage,
    ].some((value) => value?.toLowerCase().includes(normalizedQuery));
  });
}

export function creativeAnalysisListPreview(
  record: CreativeAnalysisView,
): string | null {
  if (record.summary) return record.summary;
  if (record.bucket === "pending") return "Processando…";
  if (record.bucket === "skipped" && record.errorMessage) {
    return creativeSkipReasonLabel(record.errorMessage);
  }
  if (record.bucket === "failed") {
    return creativeSkipReasonLabel(
      record.errorMessage ?? "processing_failed",
    );
  }
  return null;
}

export type AdCreativeDiagnosisMini = {
  diagnosisId: string;
  adId: string;
  confidence: "high" | "medium";
  summary: string;
  craftGaps: CreativeAnalysisCraftGap[];
};

export function parseLikelyContributorMini(row: {
  id: string;
  adId: string;
  status: string;
  likelyContributor: boolean | null;
  confidence: string | null;
  diagnosis: unknown;
}): AdCreativeDiagnosisMini | null {
  if (row.status !== "ready" || row.likelyContributor !== true) return null;
  if (row.confidence !== "high" && row.confidence !== "medium") return null;
  const diagnosis = asRecord(row.diagnosis);
  const summary =
    typeof diagnosis?.summary === "string" ? diagnosis.summary.trim() : "";
  if (!summary) return null;
  return {
    diagnosisId: row.id,
    adId: row.adId,
    confidence: row.confidence,
    summary,
    craftGaps: craftGaps(diagnosis?.craftGaps).slice(0, 3),
  };
}

/** Marketing usa dígitos; tracking às vezes grava `act_`. */
export function creativeDiagnosisAccountIds(accountId: string): string[] {
  const trimmed = accountId.trim();
  if (!trimmed) return [];
  const digits = trimmed.replace(/^act_/i, "");
  return [...new Set([trimmed, digits, `act_${digits}`])];
}
