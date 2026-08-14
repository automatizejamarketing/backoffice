/**
 * createPlannedCampaign — the approval, honoured (ADR 0022 + ADR 0023).
 *
 * With a proven mold, the campaign is created by FILTERED DUPLICATION of the proven ads (ADR 0023).
 * Without a mold the fallback path uses the wizard's niche presets — that branch lives in the UI, not
 * here.
 *
 * ONE approval publishes ACTIVE. A failure mid-tree rolls back everything created so far.
 */
import type { MetaCtx } from "@/lib/meta-business/insights";
import type { PlanAnswers } from "./build-tree";
import { createDuplicatedCampaign } from "./duplicate-campaign";
import type { AccountLimits } from "./plan-campaign";
import type { MoldRef } from "./pick-mold";
import type { CreateIssue } from "../creation/types";
import type { DuplicateProvenCampaignReports } from "@/lib/meta-business/duplicate";

export type PublishedCampaign = {
  ok: true;
  campaignId: string;
  adSetIds: string[];
  adIds: string[];
  reports?: DuplicateProvenCampaignReports;
};

export type PublishFailure = {
  ok: false;
  issues: CreateIssue[];
  /** True when objects had already been created and were deleted again. */
  rolledBack: boolean;
  /** Ids Meta refused to delete during the rollback — they need manual cleanup. */
  orphanIds?: string[];
};

export type PublishResult = PublishedCampaign | PublishFailure;

export async function createPlannedCampaign(
  ctx: MetaCtx,
  clientRef: MoldRef,
  answers: PlanAnswers,
  limits: AccountLimits = {},
): Promise<PublishResult> {
  const result = await createDuplicatedCampaign(ctx, clientRef, answers, limits);

  if (!result.ok) {
    return {
      ok: false,
      issues: result.issues,
      rolledBack: result.rolledBack,
      ...(result.orphanIds?.length ? { orphanIds: result.orphanIds } : {}),
    };
  }

  return {
    ok: true,
    campaignId: result.campaignId,
    adSetIds: result.adSetIds,
    adIds: result.adIds,
    ...(result.reports ? { reports: result.reports } : {}),
  };
}
