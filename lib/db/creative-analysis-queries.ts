import { and, desc, eq, inArray } from "drizzle-orm";

import {
  creativeDiagnosisAccountIds,
  creativeSpecMediaKind,
  parseLikelyContributorMini,
  previewFromCreativeSpec,
  type AdCreativeDiagnosisMini,
  type CreativeAnalysisMedia,
  type CreativeAnalysisRow,
} from "@/lib/creative-analysis/playground";
import { db } from "@/lib/db";
import {
  creativeDiagnosis,
  metaTrackingCreative,
  user,
  type CreativeDiagnosisMediaItem,
} from "@/lib/db/schema";
import { getMediaPublicUrl } from "@/lib/storage/media-r2";

function publicDiagnosisMediaUrl(r2Key: string): string {
  try {
    return getMediaPublicUrl(r2Key);
  } catch {
    const key = r2Key.startsWith("media/") ? r2Key : `media/${r2Key}`;
    return `/${key}`;
  }
}

function toPublicMedia(
  items: CreativeDiagnosisMediaItem[] | null | undefined,
): CreativeAnalysisMedia[] {
  if (!Array.isArray(items)) return [];
  return [...items]
    .filter(
      (item): item is CreativeDiagnosisMediaItem =>
        !!item &&
        typeof item.r2Key === "string" &&
        item.r2Key.length > 0 &&
        (item.type === "image" || item.type === "video") &&
        typeof item.order === "number",
    )
    .sort((left, right) => left.order - right.order)
    .map((item) => ({
      type: item.type,
      order: item.order,
      url: publicDiagnosisMediaUrl(item.r2Key),
    }));
}

export async function listLatestCreativeDiagnoses(
  limit: number,
): Promise<CreativeAnalysisRow[]> {
  const rows = await db
    .select({
      id: creativeDiagnosis.id,
      userId: creativeDiagnosis.userId,
      userName: user.name,
      userEmail: user.email,
      accountId: creativeDiagnosis.accountId,
      adId: creativeDiagnosis.adId,
      creativeId: creativeDiagnosis.creativeId,
      campaignId: creativeDiagnosis.campaignId,
      adsetId: creativeDiagnosis.adsetId,
      rankingDate: creativeDiagnosis.rankingDate,
      rubricVersion: creativeDiagnosis.rubricVersion,
      modelId: creativeDiagnosis.modelId,
      metricWindowStart: creativeDiagnosis.metricWindowStart,
      metricWindowEnd: creativeDiagnosis.metricWindowEnd,
      status: creativeDiagnosis.status,
      confidence: creativeDiagnosis.confidence,
      likelyContributor: creativeDiagnosis.likelyContributor,
      errorMessage: creativeDiagnosis.errorMessage,
      evidence: creativeDiagnosis.evidence,
      diagnosis: creativeDiagnosis.diagnosis,
      mediaItems: creativeDiagnosis.mediaItems,
      spec: metaTrackingCreative.spec,
      createdAt: creativeDiagnosis.createdAt,
      updatedAt: creativeDiagnosis.updatedAt,
    })
    .from(creativeDiagnosis)
    .leftJoin(user, eq(creativeDiagnosis.userId, user.id))
    .leftJoin(
      metaTrackingCreative,
      eq(creativeDiagnosis.creativeId, metaTrackingCreative.id),
    )
    .orderBy(desc(creativeDiagnosis.updatedAt))
    .limit(Math.max(1, Math.min(100, limit)));

  return rows.map(({ mediaItems, spec, ...row }) => {
    const persisted = toPublicMedia(mediaItems);
    return {
      ...row,
      media: persisted.length > 0 ? persisted : previewFromCreativeSpec(spec),
      mediaKind: persisted.some((item) => item.type === "video")
        ? "video"
        : creativeSpecMediaKind(spec),
    };
  });
}

const LIKELY_CONTRIBUTOR_LIMIT = 500;

/**
 * Último diagnóstico pronto por anúncio em que a peça é hipótese de problema.
 * Consultores leem isso na tabela de ads — sem ir ao playground.
 */
export async function listLikelyContributorDiagnosesForAccount(input: {
  userId: string;
  accountId: string;
}): Promise<AdCreativeDiagnosisMini[]> {
  const accountIds = creativeDiagnosisAccountIds(input.accountId);
  if (accountIds.length === 0) return [];

  const rows = await db
    .selectDistinctOn([creativeDiagnosis.adId], {
      id: creativeDiagnosis.id,
      adId: creativeDiagnosis.adId,
      status: creativeDiagnosis.status,
      likelyContributor: creativeDiagnosis.likelyContributor,
      confidence: creativeDiagnosis.confidence,
      diagnosis: creativeDiagnosis.diagnosis,
    })
    .from(creativeDiagnosis)
    .where(
      and(
        eq(creativeDiagnosis.userId, input.userId),
        inArray(creativeDiagnosis.accountId, accountIds),
        eq(creativeDiagnosis.status, "ready"),
        eq(creativeDiagnosis.likelyContributor, true),
        inArray(creativeDiagnosis.confidence, ["high", "medium"]),
      ),
    )
    .orderBy(creativeDiagnosis.adId, desc(creativeDiagnosis.updatedAt))
    .limit(LIKELY_CONTRIBUTOR_LIMIT);

  return rows.flatMap((row) => {
    const parsed = parseLikelyContributorMini(row);
    return parsed ? [parsed] : [];
  });
}
