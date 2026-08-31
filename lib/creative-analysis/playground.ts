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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim() !== "",
  );
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function safeErrorMessage(value: string | null): string | null {
  if (!value) return null;
  return /^[a-z0-9_:-]{1,120}$/i.test(value)
    ? value
    : "processing_failed";
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
