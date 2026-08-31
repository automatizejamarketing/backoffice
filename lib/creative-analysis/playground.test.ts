import { describe, expect, test } from "bun:test";

import {
  parseCreativeAnalysisRequest,
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
