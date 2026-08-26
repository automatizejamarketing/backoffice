import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { creativeDiagnosis } from "@/lib/db/schema";

import type { CreativeDiagnosisPlaybookRow } from "./types";

export async function loadReadyCreativeDiagnosesForUser(
  userId: string,
): Promise<CreativeDiagnosisPlaybookRow[]> {
  const rows = await db
    .select({
      id: creativeDiagnosis.id,
      adId: creativeDiagnosis.adId,
      campaignId: creativeDiagnosis.campaignId,
      likelyContributor: creativeDiagnosis.likelyContributor,
      confidence: creativeDiagnosis.confidence,
      diagnosis: creativeDiagnosis.diagnosis,
    })
    .from(creativeDiagnosis)
    .where(
      and(
        eq(creativeDiagnosis.userId, userId),
        eq(creativeDiagnosis.status, "ready"),
        inArray(creativeDiagnosis.confidence, ["high", "medium"]),
      ),
    )
    .orderBy(desc(creativeDiagnosis.updatedAt));

  return rows.map((row) => ({
    id: row.id,
    adId: row.adId,
    campaignId: row.campaignId,
    adName: null,
    likelyContributor: row.likelyContributor,
    confidence: row.confidence,
    diagnosis: row.diagnosis,
  }));
}
