import { desc, eq } from "drizzle-orm";

import type {
  CreativeAnalysisMedia,
  CreativeAnalysisRow,
} from "@/lib/creative-analysis/playground";
import { db } from "@/lib/db";
import {
  creativeDiagnosis,
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
      createdAt: creativeDiagnosis.createdAt,
      updatedAt: creativeDiagnosis.updatedAt,
    })
    .from(creativeDiagnosis)
    .leftJoin(user, eq(creativeDiagnosis.userId, user.id))
    .orderBy(desc(creativeDiagnosis.updatedAt))
    .limit(Math.max(1, Math.min(100, limit)));

  return rows.map(({ mediaItems, ...row }) => ({
    ...row,
    media: toPublicMedia(mediaItems),
  }));
}
