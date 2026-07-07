/**
 * createCampaignTree — orchestrate the three primitives into a whole campaign
 * (campaign → ad sets → ads) with reverse-order rollback (ADR 0009).
 *
 * This is what the wizard becomes and what the AI assistant calls for "create the
 * whole campaign at once". Building level-by-level across chat turns uses the
 * primitives directly instead. On any failure, every object created so far is
 * deleted in reverse order; ids Meta refuses to delete are returned as orphans.
 */

import {
  createCampaign,
  previewCampaign,
  type CreateCampaignInput,
} from "./create-campaign";
import {
  createAdSet,
  validateAdSetInput,
  type CreateAdSetInput,
} from "./create-ad-set";
import { createAd, validateAdInput, type CreateAdInput } from "./create-ad";
import { deleteMetaObjects } from "./delete";
import { type CreateIssue, localIssue } from "./types";

/** An ad set plus its ads, minus the fields the orchestrator derives. */
export type TreeAdSetSpec = {
  adSet: Omit<
    CreateAdSetInput,
    | "adAccountId"
    | "accessToken"
    | "campaignId"
    | "objective"
    | "parentUsesCampaignBudget"
    | "parentHasLifetimeBudget"
  >;
  ads: Array<
    Omit<CreateAdInput, "adAccountId" | "accessToken" | "adSetId" | "optimizationGoal">
  >;
};

export type CreateCampaignTreeInput = {
  adAccountId: string;
  accessToken: string;
  campaign: Omit<CreateCampaignInput, "adAccountId" | "accessToken">;
  adSets: TreeAdSetSpec[];
};

export type CampaignTreeSuccess = {
  ok: true;
  campaignId: string;
  adSets: Array<{ id: string; ads: Array<{ id: string; creativeId: string }> }>;
};
export type CampaignTreeFailure = {
  ok: false;
  issues: CreateIssue[];
  rolledBack: boolean;
  /** ids Meta refused to delete during rollback (need manual cleanup). */
  orphanIds?: string[];
};
export type CampaignTreeResult = CampaignTreeSuccess | CampaignTreeFailure;

function parentUsesCampaignBudget(
  c: CreateCampaignTreeInput["campaign"],
): boolean {
  return (c.dailyBudgetCents ?? 0) > 0 || (c.lifetimeBudgetCents ?? 0) > 0;
}

/** Pure: derive a full ad-set input from the tree + spec + created campaign id. */
export function deriveAdSetInput(
  tree: CreateCampaignTreeInput,
  spec: TreeAdSetSpec,
  campaignId: string,
): CreateAdSetInput {
  return {
    ...spec.adSet,
    adAccountId: tree.adAccountId,
    accessToken: tree.accessToken,
    campaignId,
    objective: tree.campaign.objective,
    parentUsesCampaignBudget: parentUsesCampaignBudget(tree.campaign),
    parentHasLifetimeBudget: (tree.campaign.lifetimeBudgetCents ?? 0) > 0,
  };
}

/** Pure: derive a full ad input from the tree + specs + created ad-set id. */
export function deriveAdInput(
  tree: CreateCampaignTreeInput,
  adSetSpec: TreeAdSetSpec,
  adSpec: TreeAdSetSpec["ads"][number],
  adSetId: string,
): CreateAdInput {
  return {
    ...adSpec,
    adAccountId: tree.adAccountId,
    accessToken: tree.accessToken,
    adSetId,
    optimizationGoal: adSetSpec.adSet.optimizationGoal,
  };
}

/** Pure shape check: ≥1 ad set, each with ≥1 ad. */
export function validateTreeShape(tree: CreateCampaignTreeInput): CreateIssue[] {
  const issues: CreateIssue[] = [];
  if (!tree.adSets?.length) {
    issues.push(
      localIssue(
        "campaign",
        "TREE_NO_ADSETS",
        "A campanha precisa de ao menos um conjunto de anúncios.",
        "Inclua ao menos um ad set em adSets.",
        ["adSets"],
      ),
    );
  }
  tree.adSets?.forEach((s, i) => {
    if (!s.ads?.length) {
      issues.push(
        localIssue(
          "adset",
          "TREE_NO_ADS",
          `O conjunto ${i} precisa de ao menos um anúncio.`,
          "Inclua ao menos um anúncio em ads.",
          ["adSets", String(i), "ads"],
        ),
      );
    }
  });
  return issues;
}

export async function createCampaignTree(
  tree: CreateCampaignTreeInput,
  opts: { skipRemoteValidation?: boolean } = {},
): Promise<CampaignTreeResult> {
  const shape = validateTreeShape(tree);
  if (shape.length) return { ok: false, issues: shape, rolledBack: false };

  // Created object ids in creation order; reversed for rollback.
  const created: string[] = [];
  const rollback = async (issues: CreateIssue[]): Promise<CampaignTreeFailure> => {
    const orphanIds = await deleteMetaObjects([...created].reverse(), tree.accessToken);
    return {
      ok: false,
      issues,
      rolledBack: true,
      ...(orphanIds.length ? { orphanIds } : {}),
    };
  };

  const camp = await createCampaign(
    { ...tree.campaign, adAccountId: tree.adAccountId, accessToken: tree.accessToken },
    opts,
  );
  if (!camp.ok) return { ok: false, issues: camp.issues, rolledBack: false };
  created.push(camp.id);

  const adSets: CampaignTreeSuccess["adSets"] = [];
  for (const spec of tree.adSets) {
    const as = await createAdSet(deriveAdSetInput(tree, spec, camp.id), opts);
    if (!as.ok) return rollback(as.issues);
    created.push(as.id);

    const ads: Array<{ id: string; creativeId: string }> = [];
    for (const adSpec of spec.ads) {
      const ad = await createAd(deriveAdInput(tree, spec, adSpec, as.id), opts);
      if (!ad.ok) return rollback(ad.issues);
      // creation order: creative then ad (so reverse deletes ad before creative).
      created.push(ad.data.creativeId, ad.data.id);
      ads.push({ id: ad.data.id, creativeId: ad.data.creativeId });
    }
    adSets.push({ id: as.id, ads });
  }

  return { ok: true, campaignId: camp.id, adSets };
}

// ───────────────────────── preview (no write) ─────────────────────────

/** Ad spec for a tree PREVIEW — the creative may still be undefined (skeleton). */
export type PreviewTreeAdSpec = Omit<TreeAdSetSpec["ads"][number], "creative"> & {
  creative?: TreeAdSetSpec["ads"][number]["creative"];
};
export type PreviewTreeAdSetSpec = {
  adSet: TreeAdSetSpec["adSet"];
  ads: PreviewTreeAdSpec[];
};
export type PreviewCampaignTreeInput = {
  adAccountId: string;
  accessToken: string;
  campaign: CreateCampaignTreeInput["campaign"];
  adSets: PreviewTreeAdSetSpec[];
};

export type CampaignTreePlan = {
  campaign: {
    name: string;
    objective: string;
    budgetMode: "CBO" | "ABO";
    dailyBudgetCents?: number;
    lifetimeBudgetCents?: number;
  };
  adSets: Array<{
    name: string;
    optimizationGoal: string;
    ads: Array<{ name: string; creativeFormat: string }>;
  }>;
};

export type CampaignTreePreviewResult = {
  /** True when the whole tree passed local validation + the campaign validate_only. */
  ok: boolean;
  /** The planned structure — ALWAYS present, so the user sees the tree even if incomplete. */
  plan: CampaignTreePlan;
  /** Everything still invalid/missing (each with reason + suggestion). Empty when ok. */
  issues: CreateIssue[];
  warnings?: CreateIssue[];
};

const PREVIEW_CAMPAIGN_ID = "<preview-campaign-id>";
const PREVIEW_ADSET_ID = "<preview-adset-id>";

function buildTreePlan(tree: PreviewCampaignTreeInput): CampaignTreePlan {
  return {
    campaign: {
      name: tree.campaign.name,
      objective: tree.campaign.objective,
      budgetMode: parentUsesCampaignBudget(tree.campaign) ? "CBO" : "ABO",
      ...(tree.campaign.dailyBudgetCents != null
        ? { dailyBudgetCents: tree.campaign.dailyBudgetCents }
        : {}),
      ...(tree.campaign.lifetimeBudgetCents != null
        ? { lifetimeBudgetCents: tree.campaign.lifetimeBudgetCents }
        : {}),
    },
    adSets: (tree.adSets ?? []).map((s) => ({
      name: s.adSet.name,
      optimizationGoal: s.adSet.optimizationGoal,
      ads: (s.ads ?? []).map((a) => ({
        name: a.name,
        creativeFormat: a.creative?.format ?? "(criativo pendente)",
      })),
    })),
  };
}

/**
 * previewCampaignTree — validate a WHOLE campaign tree without writing anything
 * (BUG-006). The campaign runs local validation + Meta `validate_only`; ad sets
 * and ads run the LOCAL validators only (Meta can't `validate_only` a child
 * without a real parent id — that final check happens at create time). Returns
 * the full plan PLUS every issue/missing field, so the agent can show the
 * structure and what's left to fill instead of stopping at the campaign level.
 */
export async function previewCampaignTree(
  tree: PreviewCampaignTreeInput,
): Promise<CampaignTreePreviewResult> {
  const plan = buildTreePlan(tree);
  const issues: CreateIssue[] = [];
  const warnings: CreateIssue[] = [];

  if (!tree.adSets?.length) {
    issues.push(
      localIssue(
        "campaign",
        "TREE_NO_ADSETS",
        "A campanha precisa de ao menos um conjunto de anúncios.",
        "Inclua ao menos um ad set em adSets.",
        ["adSets"],
      ),
    );
  }

  // Campaign: local validation + validate_only (the ONLY remote call here).
  const campPreview = await previewCampaign({
    ...tree.campaign,
    adAccountId: tree.adAccountId,
    accessToken: tree.accessToken,
  });
  if (!campPreview.ok) issues.push(...campPreview.issues);
  else if (campPreview.warnings?.length) warnings.push(...campPreview.warnings);

  const cbo = parentUsesCampaignBudget(tree.campaign);
  const parentHasLifetimeBudget = (tree.campaign.lifetimeBudgetCents ?? 0) > 0;

  (tree.adSets ?? []).forEach((spec, i) => {
    // Ad set: LOCAL validation only (placeholder campaignId satisfies the id
    // check; mirrors deriveAdSetInput so preview == create shape).
    issues.push(
      ...validateAdSetInput({
        ...spec.adSet,
        adAccountId: tree.adAccountId,
        accessToken: tree.accessToken,
        campaignId: PREVIEW_CAMPAIGN_ID,
        objective: tree.campaign.objective,
        parentUsesCampaignBudget: cbo,
        parentHasLifetimeBudget,
      }),
    );

    if (!spec.ads?.length) {
      issues.push(
        localIssue(
          "adset",
          "TREE_NO_ADS",
          `O conjunto ${i + 1} ("${spec.adSet.name}") precisa de ao menos um anúncio.`,
          "Inclua ao menos um anúncio em ads.",
          ["adSets", String(i), "ads"],
        ),
      );
      return;
    }

    spec.ads.forEach((adSpec, j) => {
      if (!adSpec.creative) {
        issues.push(
          localIssue(
            "ad",
            "AD_CREATIVE_PENDING",
            `Conjunto ${i + 1}, anúncio ${j + 1} ("${adSpec.name}"): criativo ainda não definido.`,
            "Informe a identidade (page_id/instagram via getAdIdentities), a imagem/vídeo (uploadAdImage) e o CTA para validar e criar o anúncio.",
            ["adSets", String(i), "ads", String(j), "creative"],
          ),
        );
        return;
      }
      // Ad: LOCAL validation only (placeholder adSetId satisfies the id check).
      issues.push(
        ...validateAdInput({
          ...adSpec,
          creative: adSpec.creative,
          adAccountId: tree.adAccountId,
          accessToken: tree.accessToken,
          adSetId: PREVIEW_ADSET_ID,
          optimizationGoal: spec.adSet.optimizationGoal,
        }),
      );
    });
  });

  return {
    ok: issues.length === 0,
    plan,
    issues,
    ...(warnings.length ? { warnings } : {}),
  };
}
