/**
 * migrateCampaignBudgetMode — orchestrate a CBO↔ABO budget-mode migration
 * (ADR 0010). This is the multi-object operation kept OUT of updateCampaign
 * (its sibling, like createCampaignTree vs createCampaign):
 *
 * - →CBO: a single `POST /{campaign_id}` setting the campaign budget; Meta moves
 *   budget control to the campaign and clears the ad sets' budgets.
 * - →ABO: a single `POST /{campaign_id}` with `adset_budgets` (one entry per ad
 *   set); Meta clears the campaign budget and assigns each ad set its budget.
 *
 * Encodes the documented restriction: a CBO campaign with > 70 ad sets cannot
 * turn off CBO nor change its bid strategy (ad-campaign-group reference). Runs
 * local validation → Meta `validate_only` → the real update.
 */

import { metaApiCall } from "@/lib/meta-business/api";
import { localIssue } from "../creation/types";
import { issuesFromError } from "../creation/normalize";
import {
  type CreateIssue,
  type UpdateData,
  type UpdateMode,
  type UpdateResult,
  failUpdate,
  okUpdate,
  withValidateOnly,
} from "./types";
import {
  type CampaignSnapshot,
  campaignUsesBudget,
  readCampaign,
} from "./read-current";
import { ensureObjectInAccount } from "./ownership";
import { collect, subcodeSuggestion } from "./validation";

const CBO_ADSET_CAP = 70;

export type AdSetBudgetEntry = {
  adsetId: string;
  dailyBudgetCents?: number;
  lifetimeBudgetCents?: number;
};

export type BudgetModeMigrationInput = {
  campaignId: string;
  accessToken: string;
  /** Account the campaign must belong to (ownership guard, BUG-001 / ADR 0013). */
  adAccountId?: string;
  targetMode: "CBO" | "ABO";

  /** →CBO: the campaign budget (exactly one) + optional bid strategy. */
  dailyBudgetCents?: number;
  lifetimeBudgetCents?: number;
  bidStrategy?: string;
  /** →CBO with a lifetime budget needs a stop time. */
  stopTime?: string;

  /** →ABO: per-ad-set budgets (one entry per ad set, exactly one budget each). */
  adsetBudgets?: AdSetBudgetEntry[];

  snapshot?: CampaignSnapshot;
};

type AdSetLite = { id: string; name?: string; daily_budget?: string; lifetime_budget?: string };

const cents = (n?: number): string | undefined =>
  n != null ? String(Math.round(n)) : undefined;

async function readChildAdSets(
  campaignId: string,
  accessToken: string,
): Promise<{ adSets: AdSetLite[]; total: number }> {
  const res = await metaApiCall<{
    data?: AdSetLite[];
    summary?: { total_count?: number };
  }>({
    domain: "FACEBOOK",
    method: "GET",
    path: `${campaignId}/adsets`,
    params: "fields=id,name,daily_budget,lifetime_budget&limit=200&summary=total_count",
    accessToken,
  });
  const adSets = res.data ?? [];
  return { adSets, total: res.summary?.total_count ?? adSets.length };
}

export function validateBudgetModeMigration(input: {
  targetMode: "CBO" | "ABO";
  currentlyCbo: boolean;
  adSetCount: number;
  dailyBudgetCents?: number;
  lifetimeBudgetCents?: number;
  hasStopTime: boolean;
  adsetBudgets?: AdSetBudgetEntry[];
  childAdSetIds: string[];
}): CreateIssue[] {
  const issues: CreateIssue[] = [];

  if (input.targetMode === "CBO" && input.currentlyCbo) {
    issues.push(localIssue("campaign", "ALREADY_CBO", "A campanha já usa orçamento de campanha (CBO).", "Para alterar o valor, use updateCampaign.", []));
  }
  if (input.targetMode === "ABO" && !input.currentlyCbo) {
    issues.push(localIssue("campaign", "ALREADY_ABO", "A campanha já usa orçamento por conjunto (ABO).", "Para alterar valores, use updateAdSet em cada conjunto.", []));
  }

  // > 70 ad sets + CBO: can't turn off CBO nor change bid strategy.
  if (input.currentlyCbo && input.adSetCount > CBO_ADSET_CAP && input.targetMode === "ABO") {
    issues.push(
      localIssue(
        "campaign",
        "CBO_OVER_70_CANNOT_DISABLE",
        `Campanha CBO com mais de ${CBO_ADSET_CAP} conjuntos não pode desativar o CBO (regra da Meta).`,
        "Reduza o número de conjuntos ativos ou mantenha o CBO.",
        [],
      ),
    );
  }

  if (input.targetMode === "CBO") {
    const hasDaily = (input.dailyBudgetCents ?? 0) > 0;
    const hasLifetime = (input.lifetimeBudgetCents ?? 0) > 0;
    if (hasDaily === hasLifetime) {
      issues.push(localIssue("campaign", "CBO_BUDGET_REQUIRED", "Migração para CBO exige exatamente um orçamento de campanha.", "Informe dailyBudgetCents OU lifetimeBudgetCents.", ["daily_budget"]));
    }
    if (hasLifetime && !input.hasStopTime) {
      issues.push(localIssue("campaign", "LIFETIME_REQUIRES_STOP_TIME", "Orçamento total (lifetime) da campanha exige stop_time.", "Defina stopTime ao migrar para CBO com orçamento total.", ["stop_time"]));
    }
  }

  if (input.targetMode === "ABO") {
    const entries = input.adsetBudgets ?? [];
    if (!entries.length) {
      issues.push(localIssue("campaign", "ABO_BUDGETS_REQUIRED", "Migração para ABO exige um orçamento por conjunto de anúncios.", "Informe adsetBudgets com um orçamento (daily OU lifetime) para cada conjunto.", ["adset_budgets"]));
    }
    const known = new Set(input.childAdSetIds);
    for (const e of entries) {
      const hasDaily = (e.dailyBudgetCents ?? 0) > 0;
      const hasLifetime = (e.lifetimeBudgetCents ?? 0) > 0;
      if (hasDaily === hasLifetime) {
        issues.push(localIssue("adset", "ADSET_BUDGET_XOR", `Conjunto ${e.adsetId}: informe exatamente um orçamento (daily OU lifetime).`, "Cada conjunto precisa de daily_budget OU lifetime_budget.", ["adset_budgets"]));
      }
      if (known.size && !known.has(e.adsetId)) {
        issues.push(localIssue("adset", "ADSET_NOT_IN_CAMPAIGN", `Conjunto ${e.adsetId} não pertence a esta campanha.`, "Use apenas ids de conjuntos desta campanha.", ["adset_budgets"]));
      }
    }
  }

  return issues;
}

function buildMigrationPayload(
  input: BudgetModeMigrationInput,
): URLSearchParams {
  const p = new URLSearchParams();
  if (input.targetMode === "CBO") {
    const daily = cents(input.dailyBudgetCents);
    const lifetime = cents(input.lifetimeBudgetCents);
    if (daily) p.set("daily_budget", daily);
    if (lifetime) p.set("lifetime_budget", lifetime);
    if (input.stopTime) p.set("stop_time", input.stopTime);
    if (input.bidStrategy) p.set("bid_strategy", input.bidStrategy);
  } else {
    const adsetBudgets = (input.adsetBudgets ?? []).map((e) =>
      (e.dailyBudgetCents ?? 0) > 0
        ? { adset_id: e.adsetId, daily_budget: cents(e.dailyBudgetCents) }
        : { adset_id: e.adsetId, lifetime_budget: cents(e.lifetimeBudgetCents) },
    );
    p.set("adset_budgets", JSON.stringify(adsetBudgets));
  }
  return p;
}

export async function migrateCampaignBudgetMode(
  input: BudgetModeMigrationInput,
  opts: { mode?: UpdateMode } = {},
): Promise<UpdateResult> {
  const mode = opts.mode ?? "commit";

  let snap: CampaignSnapshot;
  let children: { adSets: AdSetLite[]; total: number };
  try {
    snap = await readCampaign(input.campaignId, input.accessToken, input.snapshot);
    children = await readChildAdSets(input.campaignId, input.accessToken);
  } catch (error) {
    return failUpdate(issuesFromError(error, "update", "campaign", subcodeSuggestion));
  }

  const ownership = await ensureObjectInAccount({
    objectId: input.campaignId,
    level: "campaign",
    expectedAccountId: input.adAccountId,
    snapshotAccountId: snap.account_id,
    accessToken: input.accessToken,
  });
  if (ownership.length) return failUpdate(ownership);

  const issues = collect(
    validateBudgetModeMigration({
      targetMode: input.targetMode,
      currentlyCbo: campaignUsesBudget(snap),
      adSetCount: children.total,
      dailyBudgetCents: input.dailyBudgetCents,
      lifetimeBudgetCents: input.lifetimeBudgetCents,
      hasStopTime: Boolean(input.stopTime ?? snap.stop_time),
      adsetBudgets: input.adsetBudgets,
      childAdSetIds: children.adSets.map((a) => a.id),
    }),
  );
  if (issues.length) return failUpdate(issues);

  const body = buildMigrationPayload(input);

  if (mode !== "commit_unchecked") {
    try {
      await metaApiCall<{ success?: boolean }>({
        method: "POST",
        path: input.campaignId,
        params: "",
        body: withValidateOnly(body),
        accessToken: input.accessToken,
      });
    } catch (error) {
      return failUpdate(issuesFromError(error, "validate_only", "campaign", subcodeSuggestion));
    }
  }

  const data: UpdateData = { id: input.campaignId, strategy: "update", previousId: input.campaignId };
  if (mode === "preview") return okUpdate(data);

  try {
    await metaApiCall<{ success?: boolean }>({
      method: "POST",
      path: input.campaignId,
      params: "",
      body,
      accessToken: input.accessToken,
    });
    return okUpdate(data);
  } catch (error) {
    return failUpdate(issuesFromError(error, "update", "campaign", subcodeSuggestion));
  }
}
