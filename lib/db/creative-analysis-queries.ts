import { desc, eq } from "drizzle-orm";

import type { CreativeAnalysisRow } from "@/lib/creative-analysis/playground";
import { db } from "@/lib/db";
import { creativeDiagnosis, user } from "@/lib/db/schema";

export async function listLatestCreativeDiagnoses(
  limit: number,
): Promise<CreativeAnalysisRow[]> {
  return db
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
      createdAt: creativeDiagnosis.createdAt,
      updatedAt: creativeDiagnosis.updatedAt,
    })
    .from(creativeDiagnosis)
    .leftJoin(user, eq(creativeDiagnosis.userId, user.id))
    .orderBy(desc(creativeDiagnosis.updatedAt))
    .limit(Math.max(1, Math.min(100, limit)));
}
