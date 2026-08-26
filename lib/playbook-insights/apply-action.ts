import { recordStatusChangeAudit } from "@/lib/backoffice/meta-status-change-audit";
import {
  createCampaignEditLog,
  createDuplicationLog,
} from "@/lib/db/admin-queries";
import { recordInternalChangeEvent } from "@/lib/db/meta-tracking-event-queries";
import {
  getOpenPlaybookInsightForUser,
  updatePlaybookInsightStatus,
} from "@/lib/db/playbook-insights-queries";
import { metaApiCall } from "@/lib/meta-business/api";
import {
  duplicateCampaign,
  DuplicateInProgressError,
  duplicateErrorExtras,
} from "@/lib/meta-business/duplicate";
import {
  errorToGraphErrorReturn,
  graphErrorToClientError,
} from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { updateAdSet } from "@/lib/meta-business/marketing/update/update-ad-set";
import { updateCampaign } from "@/lib/meta-business/marketing/update/update-campaign";
import { readCampaign } from "@/lib/meta-business/marketing/update/read-current";
import type { CreateIssue } from "@/lib/meta-business/marketing/creation/types";
import { formatAccountId } from "@/lib/meta-business/marketing/update/types";
import {
  adsetBudgetFieldChanges,
  buildInternalChangeEvent,
  campaignBudgetFieldChanges,
} from "@/lib/meta-tracking/internal-change-event";
import { isMetaFakeScenarioUser } from "@/lib/meta-fake/config";
import {
  formatMinorUnitsBRL,
  hasPositiveMinorUnits,
  isPlaybookApplyActionAllowed,
  playbookApplyChangeNote,
  scaleMinorUnits,
  type PlaybookApplyActionId,
} from "./actions";

type ApplyArgs = {
  userId: string;
  insightId: string;
  action: PlaybookApplyActionId;
  actorEmail: string;
};

export type ApplyPlaybookInsightResult =
  | {
      ok: true;
      insightId: string;
      action: PlaybookApplyActionId;
      summary: string;
      skippedMeta?: boolean;
      duplicatedCampaignId?: string;
      duplicatedCampaignName?: string;
      inProgress?: boolean;
    }
  | {
      ok: false;
      error: string;
      status: number;
      code: string;
      needsPromotionUrl?: boolean;
    };

function fail(
  error: string,
  opts?: { status?: number; code?: string; needsPromotionUrl?: boolean },
): ApplyPlaybookInsightResult {
  return {
    ok: false,
    error,
    status: opts?.status ?? 400,
    code: opts?.code ?? "apply_failed",
    ...(opts?.needsPromotionUrl ? { needsPromotionUrl: true } : {}),
  };
}

function issuesMessage(issues: CreateIssue[]): string {
  const first = issues[0];
  if (!first) return "A Meta recusou a alteração.";
  return first.suggestion
    ? `${first.reason} — ${first.suggestion}`
    : first.reason;
}

function metaErrorMessage(error: unknown): string {
  const client = graphErrorToClientError(errorToGraphErrorReturn(error));
  return client.solution
    ? `${client.message} — ${client.solution}`
    : client.message;
}

async function markInsightDone(args: {
  insightId: string;
  userId: string;
  actorEmail: string;
  reviewNote: string;
}): Promise<void> {
  try {
    await updatePlaybookInsightStatus({
      insightId: args.insightId,
      userId: args.userId,
      status: "done",
      reviewedByEmail: args.actorEmail,
      reviewNote: args.reviewNote,
    });
  } catch (error) {
    console.error(
      "[playbook-apply] Meta change applied but insight status update failed",
      error,
    );
  }
}

export async function applyPlaybookInsightAction(
  args: ApplyArgs,
): Promise<ApplyPlaybookInsightResult> {
  const insight = await getOpenPlaybookInsightForUser({
    insightId: args.insightId,
    userId: args.userId,
  });
  if (!insight) {
    return fail("Sugestão não encontrada ou já tratada.", {
      status: 404,
      code: "insight_not_found",
    });
  }
  if (insight.entityLevel !== "campaign" || !insight.entityId) {
    return fail("Esta sugestão não aponta para uma campanha aplicável.", {
      code: "unsupported_entity",
    });
  }
  const metrics =
    insight.metrics &&
    typeof insight.metrics === "object" &&
    !Array.isArray(insight.metrics)
      ? (insight.metrics as Record<string, unknown>)
      : null;
  if (!isPlaybookApplyActionAllowed({ ruleId: insight.ruleId, metrics }, args.action)) {
    return fail("Esta ação não se aplica a esta sugestão.", {
      code: "action_not_allowed",
    });
  }

  const note = playbookApplyChangeNote(args.action, insight.entityName);
  const campaignId = insight.entityId;

  if (isMetaFakeScenarioUser(args.userId)) {
    const summary = `Cenário fake: ${note} (nada foi enviado à Meta).`;
    await markInsightDone({
      insightId: insight.id,
      userId: args.userId,
      actorEmail: args.actorEmail,
      reviewNote: summary,
    });
    return {
      ok: true,
      insightId: insight.id,
      action: args.action,
      summary,
      skippedMeta: true,
    };
  }

  const tokenResult = await getUserAccessTokenByUserId(args.userId);
  if (!tokenResult.success) {
    return fail(
      tokenResult.error.message || "Cliente sem conta Meta conectada.",
      { status: tokenResult.error.statusCode, code: "meta_token" },
    );
  }
  const accessToken = tokenResult.accessToken;

  try {
    if (args.action === "reactivate" || args.action === "archive") {
      return await applyStatusAction({
        ...args,
        insightId: insight.id,
        campaignId,
        campaignName: insight.entityName,
        note,
        accessToken,
        nextStatus: args.action === "reactivate" ? "ACTIVE" : "ARCHIVED",
      });
    }
    if (args.action === "scale_budget") {
      return await applyScaleBudgetAction({
        ...args,
        insightId: insight.id,
        campaignId,
        campaignName: insight.entityName,
        note,
        accessToken,
      });
    }
    return await applyDuplicateAction({
      ...args,
      insightId: insight.id,
      campaignId,
      campaignName: insight.entityName,
      note,
      accessToken,
    });
  } catch (error) {
    if (error instanceof DuplicateInProgressError) {
      const summary =
        "A duplicação foi pedida à Meta e ainda está em andamento. Atualize a lista de campanhas em instantes.";
      await markInsightDone({
        insightId: insight.id,
        userId: args.userId,
        actorEmail: args.actorEmail,
        reviewNote: `${note}. ${summary}`,
      });
      return {
        ok: true,
        insightId: insight.id,
        action: args.action,
        summary,
        inProgress: true,
      };
    }
    const extras = duplicateErrorExtras(error);
    return fail(metaErrorMessage(error), {
      code: extras.needsPromotionUrl ? "needs_promotion_url" : "meta_error",
      needsPromotionUrl: extras.needsPromotionUrl,
    });
  }
}

async function applyStatusAction(args: {
  userId: string;
  insightId: string;
  actorEmail: string;
  campaignId: string;
  campaignName: string | null;
  note: string;
  accessToken: string;
  nextStatus: "ACTIVE" | "ARCHIVED";
}): Promise<ApplyPlaybookInsightResult> {
  const snap = await readCampaign(args.campaignId, args.accessToken);
  const accountId = snap.account_id ? formatAccountId(snap.account_id) : null;
  if (!accountId) {
    return fail("Não foi possível identificar a conta de anúncios da campanha.", {
      code: "missing_account",
    });
  }

  const previousStatus = snap.status ?? snap.effective_status ?? null;
  const result = await updateCampaign({
    campaignId: args.campaignId,
    accessToken: args.accessToken,
    adAccountId: accountId,
    status: args.nextStatus,
    snapshot: snap,
  });
  if (!result.ok) {
    await recordStatusChangeAudit({
      entity: "campaign",
      backofficeUserEmail: args.actorEmail,
      targetUserId: args.userId,
      accountId,
      objectId: args.campaignId,
      objectName: args.campaignName ?? snap.name,
      campaignId: args.campaignId,
      previousStatus,
      newStatus: args.nextStatus,
      note: args.note,
      occurredAt: new Date(),
      appliedToMeta: false,
      errorMessage: issuesMessage(result.issues),
    });
    return fail(issuesMessage(result.issues), { code: "meta_rejected" });
  }

  await recordStatusChangeAudit({
    entity: "campaign",
    backofficeUserEmail: args.actorEmail,
    targetUserId: args.userId,
    accountId,
    objectId: args.campaignId,
    objectName: args.campaignName ?? snap.name,
    campaignId: args.campaignId,
    previousStatus,
    newStatus: args.nextStatus,
    note: args.note,
    occurredAt: new Date(),
    appliedToMeta: true,
  });

  const summary =
    args.nextStatus === "ACTIVE"
      ? `Campanha reativada na Meta.`
      : `Campanha arquivada na Meta.`;
  await markInsightDone({
    insightId: args.insightId,
    userId: args.userId,
    actorEmail: args.actorEmail,
    reviewNote: `${args.note}. ${summary}`,
  });
  return {
    ok: true,
    insightId: args.insightId,
    action: args.nextStatus === "ACTIVE" ? "reactivate" : "archive",
    summary,
  };
}

async function applyScaleBudgetAction(args: {
  userId: string;
  insightId: string;
  actorEmail: string;
  campaignId: string;
  campaignName: string | null;
  note: string;
  accessToken: string;
}): Promise<ApplyPlaybookInsightResult> {
  const snap = await readCampaign(args.campaignId, args.accessToken);
  const accountId = snap.account_id ? formatAccountId(snap.account_id) : null;
  if (!accountId) {
    return fail("Não foi possível identificar a conta de anúncios da campanha.", {
      code: "missing_account",
    });
  }

  if (hasPositiveMinorUnits(snap.daily_budget)) {
    const next = scaleMinorUnits(snap.daily_budget as string);
    if (!next) {
      return fail("Orçamento diário atual inválido para escala.", {
        code: "invalid_budget",
      });
    }
    const result = await updateCampaign({
      campaignId: args.campaignId,
      accessToken: args.accessToken,
      adAccountId: accountId,
      dailyBudgetCents: Number(next),
      snapshot: snap,
    });
    if (!result.ok) {
      return fail(issuesMessage(result.issues), { code: "meta_rejected" });
    }
    await recordBudgetAudit({
      userId: args.userId,
      actorEmail: args.actorEmail,
      accountId,
      campaignId: args.campaignId,
      campaignName: args.campaignName ?? snap.name ?? null,
      note: args.note,
      previousBudgetMode: "CBO",
      newBudgetMode: "CBO",
      previousDailyBudget: snap.daily_budget ?? null,
      newDailyBudget: next,
      previousLifetimeBudget: snap.lifetime_budget ?? null,
    });
    const summary = `Orçamento diário da campanha: ${formatMinorUnitsBRL(snap.daily_budget as string)} → ${formatMinorUnitsBRL(next)}.`;
    await markInsightDone({
      insightId: args.insightId,
      userId: args.userId,
      actorEmail: args.actorEmail,
      reviewNote: `${args.note}. ${summary}`,
    });
    return {
      ok: true,
      insightId: args.insightId,
      action: "scale_budget",
      summary,
    };
  }

  if (hasPositiveMinorUnits(snap.lifetime_budget)) {
    const next = scaleMinorUnits(snap.lifetime_budget as string);
    if (!next) {
      return fail("Orçamento total atual inválido para escala.", {
        code: "invalid_budget",
      });
    }
    const result = await updateCampaign({
      campaignId: args.campaignId,
      accessToken: args.accessToken,
      adAccountId: accountId,
      lifetimeBudgetCents: Number(next),
      snapshot: snap,
    });
    if (!result.ok) {
      return fail(issuesMessage(result.issues), { code: "meta_rejected" });
    }
    await recordBudgetAudit({
      userId: args.userId,
      actorEmail: args.actorEmail,
      accountId,
      campaignId: args.campaignId,
      campaignName: args.campaignName ?? snap.name ?? null,
      note: args.note,
      previousBudgetMode: "CBO",
      newBudgetMode: "CBO",
      previousDailyBudget: snap.daily_budget ?? null,
      previousLifetimeBudget: snap.lifetime_budget ?? null,
      newLifetimeBudget: next,
    });
    const summary = `Orçamento total da campanha: ${formatMinorUnitsBRL(snap.lifetime_budget as string)} → ${formatMinorUnitsBRL(next)}.`;
    await markInsightDone({
      insightId: args.insightId,
      userId: args.userId,
      actorEmail: args.actorEmail,
      reviewNote: `${args.note}. ${summary}`,
    });
    return {
      ok: true,
      insightId: args.insightId,
      action: "scale_budget",
      summary,
    };
  }

  return applyAboScale({
    ...args,
    accountId,
    campaignName: args.campaignName ?? snap.name ?? null,
  });
}

async function applyAboScale(args: {
  userId: string;
  insightId: string;
  actorEmail: string;
  campaignId: string;
  campaignName: string | null;
  note: string;
  accessToken: string;
  accountId: string;
}): Promise<ApplyPlaybookInsightResult> {
  const listed = await metaApiCall<{
    data?: Array<{
      id: string;
      name?: string;
      daily_budget?: string;
      lifetime_budget?: string;
      status?: string;
    }>;
  }>({
    method: "GET",
    path: `${args.campaignId}/adsets`,
    params: "fields=id,name,daily_budget,lifetime_budget,status&limit=100",
    accessToken: args.accessToken,
  });

  const scalable = (listed.data ?? []).filter(
    (adSet) =>
      adSet.status !== "DELETED" &&
      adSet.status !== "ARCHIVED" &&
      (hasPositiveMinorUnits(adSet.daily_budget) ||
        hasPositiveMinorUnits(adSet.lifetime_budget)),
  );
  if (scalable.length === 0) {
    return fail(
      "Não há orçamento na campanha nem nos conjuntos para aumentar. Confira se a campanha usa CBO/ABO com verba configurada.",
      { code: "no_budget" },
    );
  }

  const planned = scalable.map((adSet) => {
    if (hasPositiveMinorUnits(adSet.daily_budget)) {
      const next = scaleMinorUnits(adSet.daily_budget as string);
      return {
        adSet,
        dailyBudgetCents: next ? Number(next) : null,
        lifetimeBudgetCents: null as number | null,
        nextDaily: next,
        nextLifetime: null as string | null,
      };
    }
    const next = scaleMinorUnits(adSet.lifetime_budget as string);
    return {
      adSet,
      dailyBudgetCents: null as number | null,
      lifetimeBudgetCents: next ? Number(next) : null,
      nextDaily: null as string | null,
      nextLifetime: next,
    };
  });

  if (planned.some((row) => row.dailyBudgetCents == null && row.lifetimeBudgetCents == null)) {
    return fail("Um conjunto tem orçamento inválido para escala.", {
      code: "invalid_budget",
    });
  }

  for (const row of planned) {
    const preview = await updateAdSet(
      {
        adSetId: row.adSet.id,
        accessToken: args.accessToken,
        adAccountId: args.accountId,
        ...(row.dailyBudgetCents != null
          ? { dailyBudgetCents: row.dailyBudgetCents }
          : { lifetimeBudgetCents: row.lifetimeBudgetCents as number }),
      },
      { mode: "preview" },
    );
    if (!preview.ok) {
      return fail(issuesMessage(preview.issues), { code: "meta_rejected" });
    }
  }

  for (const row of planned) {
    const result = await updateAdSet(
      {
        adSetId: row.adSet.id,
        accessToken: args.accessToken,
        adAccountId: args.accountId,
        ...(row.dailyBudgetCents != null
          ? { dailyBudgetCents: row.dailyBudgetCents }
          : { lifetimeBudgetCents: row.lifetimeBudgetCents as number }),
      },
      { mode: "commit_unchecked" },
    );
    if (!result.ok) {
      return fail(issuesMessage(result.issues), { code: "meta_rejected" });
    }
  }

  const adsetBudgetChanges = planned.map((row) => ({
    adsetId: row.adSet.id,
    adsetName: row.adSet.name,
    previousDailyBudget: row.adSet.daily_budget ?? null,
    newDailyBudget: row.nextDaily,
    previousLifetimeBudget: row.adSet.lifetime_budget ?? null,
    newLifetimeBudget: row.nextLifetime,
  }));

  await recordBudgetAudit({
    userId: args.userId,
    actorEmail: args.actorEmail,
    accountId: args.accountId,
    campaignId: args.campaignId,
    campaignName: args.campaignName,
    note: args.note,
    previousBudgetMode: "ABO",
    newBudgetMode: "ABO",
    previousDailyBudget: null,
    previousLifetimeBudget: null,
    adsetBudgetChanges,
  });

  const summary = `Orçamento de ${planned.length} conjunto${planned.length === 1 ? "" : "s"} aumentado em 20%.`;
  await markInsightDone({
    insightId: args.insightId,
    userId: args.userId,
    actorEmail: args.actorEmail,
    reviewNote: `${args.note}. ${summary}`,
  });
  return {
    ok: true,
    insightId: args.insightId,
    action: "scale_budget",
    summary,
  };
}

async function recordBudgetAudit(args: {
  userId: string;
  actorEmail: string;
  accountId: string;
  campaignId: string;
  campaignName: string | null;
  note: string;
  previousBudgetMode: "CBO" | "ABO";
  newBudgetMode: "CBO" | "ABO";
  previousDailyBudget?: string | null;
  newDailyBudget?: string;
  previousLifetimeBudget?: string | null;
  newLifetimeBudget?: string;
  adsetBudgetChanges?: Array<{
    adsetId: string;
    adsetName?: string;
    previousDailyBudget?: string | null;
    newDailyBudget?: string | null;
    previousLifetimeBudget?: string | null;
    newLifetimeBudget?: string | null;
  }>;
}): Promise<void> {
  let logId: string | undefined;
  try {
    const log = await createCampaignEditLog({
      backofficeUserEmail: args.actorEmail,
      targetUserId: args.userId,
      campaignId: args.campaignId,
      accountId: args.accountId,
      campaignName: args.campaignName ?? undefined,
      previousBudgetMode: args.previousBudgetMode,
      newBudgetMode: args.newBudgetMode,
      previousDailyBudget: args.previousDailyBudget,
      newDailyBudget: args.newDailyBudget,
      previousLifetimeBudget: args.previousLifetimeBudget,
      newLifetimeBudget: args.newLifetimeBudget,
      adsetBudgetChanges: args.adsetBudgetChanges,
      note: args.note,
      appliedToMeta: true,
      source: "admin",
    });
    logId = log?.id;
  } catch (error) {
    console.error("[playbook-apply] failed to write campaign_edit_logs", error);
  }

  const occurredAt = new Date();
  const campaignChanges =
    args.newBudgetMode === "ABO"
      ? []
      : campaignBudgetFieldChanges({
          mode: args.newBudgetMode,
          previousDailyBudget: args.previousDailyBudget ?? null,
          previousLifetimeBudget: args.previousLifetimeBudget ?? null,
          nextDailyBudget: args.newDailyBudget,
          nextLifetimeBudget: args.newLifetimeBudget,
        });

  const tracked = [
    {
      entityLevel: "campaign" as const,
      entityId: args.campaignId,
      entityName: args.campaignName,
      adsetId: null as string | null,
      changes: campaignChanges,
    },
    ...(args.adsetBudgetChanges ?? []).map((adSet) => ({
      entityLevel: "adset" as const,
      entityId: adSet.adsetId,
      entityName: adSet.adsetName ?? null,
      adsetId: adSet.adsetId,
      changes: adsetBudgetFieldChanges(adSet),
    })),
  ];

  for (const row of tracked) {
    if (row.changes.length === 0) continue;
    const event = buildInternalChangeEvent({
      source: "backoffice_admin",
      userId: args.userId,
      accountId: args.accountId,
      entityLevel: row.entityLevel,
      entityId: row.entityId,
      entityName: row.entityName,
      campaignId: args.campaignId,
      adsetId: row.adsetId,
      changeKind: "config_change",
      changes: row.changes,
      actorEmail: args.actorEmail,
      note: args.note,
      occurredAt,
      appliedToMeta: true,
      legacy: logId ? { table: "campaign_edit_logs", id: logId } : null,
    });
    if (event.ok && event.event) {
      await recordInternalChangeEvent(event.event);
    }
  }
}

async function applyDuplicateAction(args: {
  userId: string;
  insightId: string;
  actorEmail: string;
  campaignId: string;
  campaignName: string | null;
  note: string;
  accessToken: string;
}): Promise<ApplyPlaybookInsightResult> {
  const snap = await readCampaign(args.campaignId, args.accessToken);
  const accountId = snap.account_id ? formatAccountId(snap.account_id) : null;
  if (!accountId) {
    return fail("Não foi possível identificar a conta de anúncios da campanha.", {
      code: "missing_account",
    });
  }

  const result = await duplicateCampaign({
    accountId,
    campaignId: args.campaignId,
    accessToken: args.accessToken,
  });

  try {
    await createDuplicationLog({
      backofficeUserEmail: args.actorEmail,
      targetUserId: args.userId,
      entity: "campaign",
      sourceId: args.campaignId,
      sourceName: result.sourceName,
      newId: result.id,
      newName: result.name,
    });
  } catch (error) {
    console.error("[playbook-apply] failed to write duplication log", error);
  }

  const summary = `Campanha duplicada: "${result.name}".`;
  await markInsightDone({
    insightId: args.insightId,
    userId: args.userId,
    actorEmail: args.actorEmail,
    reviewNote: `${args.note}. ${summary}`,
  });
  return {
    ok: true,
    insightId: args.insightId,
    action: "duplicate",
    summary,
    duplicatedCampaignId: result.id,
    duplicatedCampaignName: result.name,
  };
}
