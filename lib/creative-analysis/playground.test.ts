import { describe, expect, test } from "bun:test";

import {
  creativeAnalysisListPreview,
  creativeDiagnosisAccountIds,
  creativeSpecMediaKind,
  describePlaygroundUpstreamFailure,
  filterCreativeAnalysisViews,
  parseCreativeAnalysisRequest,
  parseLikelyContributorMini,
  previewFromCreativeSpec,
  summarizeCreativeAnalyses,
  type CreativeAnalysisRow,
} from "./playground";

function row(
  overrides: Partial<CreativeAnalysisRow> = {},
): CreativeAnalysisRow {
  return {
    id: "diagnosis-1",
    userId: "user-1",
    userName: "Restaurante Exemplo",
    userEmail: "owner@example.com",
    accountId: "account-1",
    adId: "ad-1",
    creativeId: "creative-1",
    campaignId: "campaign-1",
    adsetId: "adset-1",
    rankingDate: "2026-08-30",
    rubricVersion: "rubric-v1",
    modelId: "model-1",
    metricWindowStart: "2026-08-03",
    metricWindowEnd: "2026-08-30",
    status: "ready",
    confidence: "high",
    likelyContributor: true,
    errorMessage: null,
    evidence: {},
    diagnosis: {},
    media: [],
    mediaKind: "unknown",
    createdAt: new Date("2026-08-30T12:00:00Z"),
    updatedAt: new Date("2026-08-30T12:05:00Z"),
    ...overrides,
  };
}

describe("parseCreativeAnalysisRequest", () => {
  test("accepts a bounded eligible preview", () => {
    expect(
      parseCreativeAnalysisRequest({
        action: "preview",
        scope: "eligible",
        limit: 5,
      }),
    ).toEqual({
      action: "preview",
      scope: "eligible",
      limit: 5,
      adId: undefined,
      force: false,
    });
  });

  test("trims an ad id and accepts force only for an ad", () => {
    expect(
      parseCreativeAnalysisRequest({
        action: "run",
        scope: "ad",
        limit: 1,
        adId: " 120123 ",
        force: true,
      }),
    ).toMatchObject({ adId: "120123", force: true });

    expect(() =>
      parseCreativeAnalysisRequest({
        action: "run",
        scope: "eligible",
        limit: "all",
        force: true,
      }),
    ).toThrow("force só é permitido");
  });

  test("rejects unknown fields and invalid limits", () => {
    expect(() =>
      parseCreativeAnalysisRequest({
        action: "preview",
        scope: "eligible",
        limit: 100,
      }),
    ).toThrow("limit deve ser 1, 3, 5 ou all");
    expect(() =>
      parseCreativeAnalysisRequest({
        action: "preview",
        scope: "eligible",
        limit: 3,
        secret: "must-not-pass-through",
      }),
    ).toThrow("campos não permitidos");
  });
});

describe("summarizeCreativeAnalyses", () => {
  test("builds status counts and separates forced controls", () => {
    const result = summarizeCreativeAnalyses([
      row(),
      row({
        id: "negative",
        likelyContributor: false,
        confidence: "medium",
      }),
      row({ id: "pending", status: "pending", likelyContributor: null }),
      row({
        id: "control",
        status: "skipped",
        likelyContributor: null,
        errorMessage: "forced_control",
      }),
      row({
        id: "skipped",
        status: "skipped",
        likelyContributor: null,
        errorMessage: "insufficient_sample",
      }),
      row({ id: "failed", status: "failed", likelyContributor: null }),
    ]);

    expect(result.summary).toEqual({
      total: 6,
      analyzed: 2,
      positive: 1,
      negative: 1,
      pending: 1,
      skipped: 1,
      control: 1,
      failed: 1,
    });
  });

  test("extracts explanations, evidence and metric comparisons", () => {
    const result = summarizeCreativeAnalyses([
      row({
        diagnosis: {
          summary: "O gancho demora a mostrar o produto.",
          citations: ["CTR 7d abaixo dos anúncios irmãos."],
          alternativeExplanations: ["Oferta pode estar pouco clara."],
          craftGaps: [
            {
              dimension: "hook",
              finding: "Produto aparece tarde.",
              suggestion: "Abrir com o prato pronto.",
            },
          ],
        },
        evidence: {
          gaps: ["ctr_7d"],
          siblingCount: 3,
          windows: {
            candidate: { "7d": { ctr: 0.01, roas: 1.2 } },
            siblings: { "7d": { ctr: 0.02, roas: 2.4 } },
          },
        },
      }),
    ]);

    expect(result.records[0]).toMatchObject({
      bucket: "positive",
      summary: "O gancho demora a mostrar o produto.",
      evidenceGaps: ["ctr_7d"],
      siblingCount: 3,
      craftGaps: [{ dimension: "hook" }],
    });
    expect(result.records[0]?.metricComparisons).toEqual([
      {
        window: "7d",
        metric: "ctr",
        candidate: 0.01,
        siblings: 0.02,
        deltaPercent: -50,
      },
      {
        window: "7d",
        metric: "roas",
        candidate: 1.2,
        siblings: 2.4,
        deltaPercent: -50,
      },
    ]);
  });

  test("passes through persisted diagnosis media urls", () => {
    const media = [
      {
        type: "video" as const,
        order: 0,
        url: "https://media.example/creative.mp4",
      },
    ];
    const result = summarizeCreativeAnalyses([row({ media })]);
    expect(result.records[0]?.media).toEqual(media);
  });

  test("extracts a tracking spec poster when diagnosis media was deleted", () => {
    expect(
      previewFromCreativeSpec({
        thumbnail_url: "https://cdn.meta/thumb.jpg",
        object_story_spec: {
          video_data: { image_url: "https://cdn.meta/poster.jpg" },
        },
      }),
    ).toEqual([
      { type: "image", order: 0, url: "https://cdn.meta/thumb.jpg" },
      { type: "image", order: 1, url: "https://cdn.meta/poster.jpg" },
    ]);
  });

  test("classifies video specs even without a poster url", () => {
    expect(
      creativeSpecMediaKind({
        object_type: "VIDEO",
        object_story_spec: { video_data: { video_id: "123" } },
      }),
    ).toBe("video");
  });

  test("does not expose arbitrary persisted failure details", () => {
    const result = summarizeCreativeAnalyses([
      row({
        status: "failed",
        likelyContributor: null,
        errorMessage:
          "request failed against https://secret-host.internal?token=abc",
      }),
    ]);

    expect(result.records[0]?.errorMessage).toBe("processing_failed");
  });
});

describe("filterCreativeAnalysisViews", () => {
  const listed = summarizeCreativeAnalyses([
    row(),
    row({
      id: "skipped",
      status: "skipped",
      likelyContributor: null,
      errorMessage: "insufficient_sample",
    }),
    row({
      id: "negative",
      likelyContributor: false,
      confidence: "medium",
    }),
  ]).records;

  test("hides skipped rows in the default Recentes recorte", () => {
    expect(
      filterCreativeAnalysisViews(listed, {
        bucket: "all",
        showSkipped: false,
        confidence: "all",
        query: "",
      }).map((item) => item.id),
    ).toEqual(["diagnosis-1", "negative"]);
  });

  test("includes skipped rows when asked", () => {
    expect(
      filterCreativeAnalysisViews(listed, {
        bucket: "all",
        showSkipped: true,
        confidence: "all",
        query: "",
      }).map((item) => item.id),
    ).toEqual(["diagnosis-1", "skipped", "negative"]);
  });

  test("the Ignorados chip still lists only skipped rows", () => {
    expect(
      filterCreativeAnalysisViews(listed, {
        bucket: "skipped",
        showSkipped: false,
        confidence: "all",
        query: "",
      }).map((item) => item.id),
    ).toEqual(["skipped"]);
  });
});

describe("creativeAnalysisListPreview", () => {
  test("shows the Portuguese skip reason when there is no summary", () => {
    const [skipped] = summarizeCreativeAnalyses([
      row({
        status: "skipped",
        likelyContributor: null,
        errorMessage: "metrics_do_not_underperform",
        diagnosis: {},
      }),
    ]).records;
    expect(creativeAnalysisListPreview(skipped!)).toContain("Não está pior");
  });
});

describe("parseLikelyContributorMini", () => {
  test("keeps the latest ready likely-contributor diagnosis for the ads table", () => {
    expect(
      parseLikelyContributorMini({
        id: "diag-1",
        adId: "ad-1",
        status: "ready",
        likelyContributor: true,
        confidence: "high",
        diagnosis: {
          summary: "O gancho demora a mostrar o produto.",
          craftGaps: [
            {
              dimension: "hook",
              finding: "Produto aparece tarde.",
              suggestion: "Abrir com o prato.",
            },
          ],
        },
      }),
    ).toEqual({
      diagnosisId: "diag-1",
      adId: "ad-1",
      confidence: "high",
      summary: "O gancho demora a mostrar o produto.",
      craftGaps: [
        {
          dimension: "hook",
          finding: "Produto aparece tarde.",
          suggestion: "Abrir com o prato.",
        },
      ],
    });
  });

  test("drops skipped, negative, low-confidence and empty summaries", () => {
    expect(
      parseLikelyContributorMini({
        id: "skip",
        adId: "ad-1",
        status: "skipped",
        likelyContributor: true,
        confidence: "high",
        diagnosis: { summary: "não deveria aparecer" },
      }),
    ).toBeNull();
    expect(
      parseLikelyContributorMini({
        id: "ok",
        adId: "ad-1",
        status: "ready",
        likelyContributor: false,
        confidence: "high",
        diagnosis: { summary: "criativo parece ok" },
      }),
    ).toBeNull();
    expect(
      parseLikelyContributorMini({
        id: "low",
        adId: "ad-1",
        status: "ready",
        likelyContributor: true,
        confidence: "low",
        diagnosis: { summary: "incerto" },
      }),
    ).toBeNull();
    expect(
      parseLikelyContributorMini({
        id: "empty",
        adId: "ad-1",
        status: "ready",
        likelyContributor: true,
        confidence: "medium",
        diagnosis: { summary: "  " },
      }),
    ).toBeNull();
  });
});

describe("creativeDiagnosisAccountIds", () => {
  test("matches both digit and act_ account ids", () => {
    expect(creativeDiagnosisAccountIds("act_123")).toEqual([
      "act_123",
      "123",
    ]);
    expect(creativeDiagnosisAccountIds("123")).toEqual(["123", "act_123"]);
  });
});

describe("describePlaygroundUpstreamFailure", () => {
  test("explains auth, playground lock and delivery lock", () => {
    expect(
      describePlaygroundUpstreamFailure({
        status: 401,
        body: { error: "Unauthorized" },
      }),
    ).toContain("autenticação (401)");
    expect(
      describePlaygroundUpstreamFailure({ status: 403, body: {} }),
    ).toContain("CREATIVE_ANALYSIS_PLAYGROUND_ENABLED");
    expect(
      describePlaygroundUpstreamFailure({
        status: 409,
        body: {
          error:
            "Disable CREATIVE_ANALYSIS_DELIVERY_ENABLED before using the playground",
        },
      }),
    ).toContain("DELIVERY_ENABLED");
  });

  test("keeps a short upstream error and hides urls", () => {
    expect(
      describePlaygroundUpstreamFailure({
        status: 500,
        body: { error: "Failed to run creative analysis playground" },
      }),
    ).toBe(
      "O frontend recusou a solicitação (500): Failed to run creative analysis playground",
    );
    expect(
      describePlaygroundUpstreamFailure({
        status: 502,
        body: { error: "https://secret-host.internal/fail" },
      }),
    ).toBe("O frontend recusou a solicitação (502).");
  });
});
