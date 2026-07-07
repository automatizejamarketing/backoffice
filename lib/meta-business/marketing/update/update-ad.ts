/**
 * updateAd — unified Meta ad UPDATE primitive (ADR 0010), sibling of createAd.
 *
 * Single entry point for editing an ad:
 * - Ad-level fields settable in place via POST /{ad_id}: name, status,
 *   conversion_domain, tracking_specs, adlabels (via extraFields).
 * - Creative CONTENT change: a new `creative` spec rebuilds a creative
 *   (reusing createAd's builder/upload via {@link createCreative}) and repoints
 *   the ad. A bare `{ format: "creative_id" }` swaps the reference only.
 * - replace_paused fallback: if Meta refuses an in-place repoint (active/
 *   engaged ad), a paused copy carrying the new creative is created in the same
 *   ad set and the original is paused — the ad id CHANGES (reported in the
 *   result). On by default; disable with `allowReplacePaused: false`.
 *
 * Endpoints: POST /{ad_id}; POST /act_{id}/adcreatives; POST /{ad_id}/copies.
 */

import { metaApiCall } from "@/lib/meta-business/api";
import { GraphApiError } from "@/lib/meta-business/error";
import { localIssue, mergeExtraFields } from "../creation/types";
import { issuesFromError } from "../creation/normalize";
import { deleteMetaObject } from "../creation/delete";
import {
  type AdCreativeInput,
  type CreateAdInput,
  createCreative,
  previewAd,
  validateAdInput,
} from "../creation/create-ad";
import {
  type CreateIssue,
  type PreviewResult,
  type UpdateData,
  type UpdateMode,
  type UpdateResult,
  type UpdateStrategy,
  failUpdate,
  formatAccountId,
  okUpdate,
  withValidateOnly,
} from "./types";
import { type AdSnapshot, readAd } from "./read-current";
import { ensureObjectInAccount } from "./ownership";
import {
  collect,
  reviewTriggerWarnings,
  subcodeSuggestion,
  validateUpdateStatus,
} from "./validation";

export type UpdateAdInput = {
  adId: string;
  accessToken: string;
  /** Required only when `creative` rebuilds content (new creative is created here). */
  adAccountId?: string;

  name?: string;
  status?: string;
  conversionDomain?: string;
  /** Raw Meta `tracking_specs` (sent as JSON). */
  trackingSpecs?: unknown;

  /** New creative: rebuild content (+ repoint) or swap a creative_id reference. */
  creative?: AdCreativeInput;
  creativeName?: string;
  urlTags?: string;
  creativeExtraFields?: Record<string, unknown>;

  /** Allow the replace_paused fallback when an in-place repoint is refused. Default true. */
  allowReplacePaused?: boolean;

  snapshot?: AdSnapshot;
  extraFields?: Record<string, unknown>;
};

/**
 * Skip the GET unless we're changing the creative — ad-level field edits
 * (status/name/conversion_domain/tracking_specs) need no current state, and the
 * replace_paused fallback only needs adset_id on a creative change.
 */
async function resolveSnapshot(input: UpdateAdInput): Promise<AdSnapshot> {
  if (input.snapshot) return input.snapshot;
  if (input.creative) return readAd(input.adId, input.accessToken);
  return { id: input.adId };
}

/** A 4xx, non-transient Graph rejection — the "can't edit in place" signal. */
function isRepointRejected(error: unknown): boolean {
  if (!(error instanceof GraphApiError)) return false;
  const { statusCode, reason } = error.errorReturn;
  return statusCode >= 400 && statusCode < 500 && !reason.isTransient;
}

/** Build a CreateAdInput shell so we can reuse the creative builder/validator. */
function asCreateAdInput(input: UpdateAdInput, snap: AdSnapshot): CreateAdInput {
  return {
    adAccountId: input.adAccountId ?? "",
    accessToken: input.accessToken,
    adSetId: snap.adset_id ?? "",
    name: input.name ?? snap.name ?? "anúncio",
    creative: input.creative as AdCreativeInput,
    ...(input.creativeName !== undefined && { creativeName: input.creativeName }),
    ...(input.urlTags !== undefined && { urlTags: input.urlTags }),
    ...(input.creativeExtraFields !== undefined && {
      creativeExtraFields: input.creativeExtraFields,
    }),
  };
}

function hasAdLevelChange(input: UpdateAdInput): boolean {
  return (
    input.name !== undefined ||
    input.status !== undefined ||
    input.conversionDomain !== undefined ||
    input.trackingSpecs !== undefined ||
    input.extraFields !== undefined
  );
}

/** Ad-level POST body (no creative — that's handled by repoint). */
export function buildAdUpdatePayload(input: UpdateAdInput): URLSearchParams {
  const p = new URLSearchParams();
  if (input.name !== undefined) p.set("name", input.name.trim());
  if (input.status !== undefined) p.set("status", input.status);
  if (input.conversionDomain !== undefined) p.set("conversion_domain", input.conversionDomain);
  if (input.trackingSpecs !== undefined) p.set("tracking_specs", JSON.stringify(input.trackingSpecs));
  mergeExtraFields(p, input.extraFields);
  return p;
}

/** Pure local validation (collect-all). No Meta calls. */
export function validateUpdateAdInput(
  input: UpdateAdInput,
  snap: AdSnapshot,
): { issues: CreateIssue[]; warnings: CreateIssue[] } {
  const issues = collect(
    input.name !== undefined && !input.name.trim()
      ? [localIssue("ad", "NAME_EMPTY", "O nome do anúncio não pode ser vazio.", "Informe um name não vazio ou não envie o campo.", ["name"])]
      : [],
    validateUpdateStatus("ad", input.status),
  );

  if (!input.creative && !hasAdLevelChange(input)) {
    issues.push(
      localIssue(
        "ad",
        "NO_CHANGES",
        "Nenhuma alteração foi enviada para o anúncio.",
        "Informe ao menos um campo (name, status, conversionDomain, trackingSpecs) ou um creative.",
      ),
    );
  }

  if (input.creative) {
    if (input.creative.format !== "creative_id" && !input.adAccountId) {
      issues.push(
        localIssue(
          "ad",
          "ACCOUNT_ID_REQUIRED",
          "Para reconstruir o criativo é necessário o adAccountId (o novo criativo é criado na conta).",
          "Passe adAccountId; ou troque apenas a referência usando creative.format='creative_id'.",
          ["adAccountId"],
        ),
      );
    }
    // Reuse the full creative-format validation from createAd (name/adSetId are
    // satisfied from the snapshot, optimizationGoal omitted so the ad-level
    // conversion_domain rule isn't re-applied on an ad that already has one).
    const creativeIssues = validateAdInput(asCreateAdInput(input, snap)).filter(
      (i) => i.level === "creative",
    );
    issues.push(...creativeIssues);
  }

  const changed = new Set<string>();
  if (input.creative) changed.add("creative");
  const warnings = reviewTriggerWarnings("ad", changed);

  return { issues, warnings };
}

/**
 * Repoint an ad to `creativeId` in place; on a "can't edit in place" rejection,
 * fall back to replace_paused (copy + repoint copy + pause original) when
 * allowed. Shared by updateAd and the migrated promotion-link flow.
 */
export async function repointWithFallback(args: {
  ad: Pick<AdSnapshot, "id" | "adset_id">;
  creativeId: string;
  accessToken: string;
  allowReplacePaused: boolean;
}): Promise<
  | { ok: true; strategy: Extract<UpdateStrategy, "repoint" | "replace_paused">; id: string; pausedId?: string }
  | { ok: false; issues: CreateIssue[] }
> {
  const { ad, creativeId, accessToken, allowReplacePaused } = args;
  const repoint = (adId: string) =>
    metaApiCall<{ success?: boolean; id?: string }>({
      method: "POST",
      path: adId,
      params: "",
      body: new URLSearchParams({ creative: JSON.stringify({ creative_id: creativeId }) }),
      accessToken,
    });

  try {
    await repoint(ad.id);
    return { ok: true, strategy: "repoint", id: ad.id };
  } catch (error) {
    if (!allowReplacePaused || !isRepointRejected(error) || !ad.adset_id) {
      return { ok: false, issues: issuesFromError(error, "update", "ad", subcodeSuggestion) };
    }
  }

  // Fallback: copy into the same ad set, repoint the copy, pause the original.
  try {
    const copy = await metaApiCall<{ copied_ad_id?: string }>({
      method: "POST",
      path: `${ad.id}/copies`,
      params: "",
      body: new URLSearchParams({
        adset_id: ad.adset_id,
        status_option: "INHERITED_FROM_SOURCE",
        rename_options: JSON.stringify({ rename_strategy: "NO_RENAME" }),
      }),
      accessToken,
    });
    const newAdId = copy.copied_ad_id;
    if (!newAdId) {
      return {
        ok: false,
        issues: [
          localIssue("ad", "COPY_NO_ID", "A Meta não retornou o id do anúncio copiado.", "Tente novamente em instantes."),
        ],
      };
    }
    await repoint(newAdId);
    await metaApiCall<{ success?: boolean }>({
      method: "POST",
      path: ad.id,
      params: "",
      body: new URLSearchParams({ status: "PAUSED" }),
      accessToken,
    });
    return { ok: true, strategy: "replace_paused", id: newAdId, pausedId: ad.id };
  } catch (error) {
    return { ok: false, issues: issuesFromError(error, "update", "ad", subcodeSuggestion) };
  }
}

export async function previewUpdateAd(input: UpdateAdInput): Promise<PreviewResult> {
  let snap: AdSnapshot;
  try {
    snap = await resolveSnapshot(input);
  } catch (error) {
    return { ok: false, issues: issuesFromError(error, "validate_only", "ad", subcodeSuggestion) };
  }

  const ownership = await ensureObjectInAccount({
    objectId: input.adId,
    level: "ad",
    expectedAccountId: input.adAccountId,
    snapshotAccountId: snap.account_id,
    accessToken: input.accessToken,
  });
  if (ownership.length) return { ok: false, issues: ownership };

  const { issues, warnings } = validateUpdateAdInput(input, snap);
  if (issues.length) return { ok: false, issues };

  // Validate the creative spec (the risky part) without creating it.
  if (input.creative) {
    const cprev = await previewAd(asCreateAdInput(input, snap));
    if (!cprev.ok) return cprev;
  }

  const body = buildAdUpdatePayload(input);
  if ([...body.keys()].length) {
    try {
      await metaApiCall<{ success?: boolean }>({
        method: "POST",
        path: input.adId,
        params: "",
        body: withValidateOnly(body),
        accessToken: input.accessToken,
      });
    } catch (error) {
      return { ok: false, issues: issuesFromError(error, "validate_only", "ad", subcodeSuggestion) };
    }
  }

  const payload = Object.fromEntries(body) as Record<string, string>;
  return warnings.length ? { ok: true, payload, warnings } : { ok: true, payload };
}

export async function updateAd(
  input: UpdateAdInput,
  opts: { mode?: UpdateMode } = {},
): Promise<UpdateResult> {
  const mode = opts.mode ?? "commit";
  const allowReplacePaused = input.allowReplacePaused !== false;

  let snap: AdSnapshot;
  try {
    snap = await resolveSnapshot(input);
  } catch (error) {
    return failUpdate(issuesFromError(error, "update", "ad", subcodeSuggestion));
  }

  const ownership = await ensureObjectInAccount({
    objectId: input.adId,
    level: "ad",
    expectedAccountId: input.adAccountId,
    snapshotAccountId: snap.account_id,
    accessToken: input.accessToken,
  });
  if (ownership.length) return failUpdate(ownership);

  const { issues, warnings } = validateUpdateAdInput(input, snap);
  if (issues.length) return failUpdate(issues);

  if (mode === "preview") {
    const data: UpdateData = { id: input.adId, strategy: "update", previousId: input.adId };
    return okUpdate(data, warnings);
  }

  const skipRemote = mode === "commit_unchecked";
  let strategy: UpdateStrategy = "update";
  let effectiveAdId = input.adId;
  let pausedId: string | undefined;
  let creativeId: string | undefined;
  let createdCreative = false;

  // 1) Creative change → (re)build creative + repoint (with fallback).
  if (input.creative) {
    if (input.creative.format === "creative_id") {
      creativeId = input.creative.creativeId;
    } else {
      const account = formatAccountId(input.adAccountId ?? "");
      const built = await createCreative(account, input.accessToken, asCreateAdInput(input, snap), skipRemote);
      if ("issues" in built) return failUpdate(built.issues);
      creativeId = built.id;
      createdCreative = true;
    }

    const repointed = await repointWithFallback({
      ad: { id: input.adId, adset_id: snap.adset_id },
      creativeId,
      accessToken: input.accessToken,
      allowReplacePaused,
    });
    if (!repointed.ok) {
      // Self-rollback: drop the orphan creative we just created.
      if (createdCreative && creativeId) await deleteMetaObject(creativeId, input.accessToken);
      return failUpdate(repointed.issues);
    }
    strategy = repointed.strategy;
    effectiveAdId = repointed.id;
    pausedId = repointed.pausedId;
  }

  // 2) Ad-level fields → POST to the EFFECTIVE ad (new copy if replace_paused).
  if (hasAdLevelChange(input)) {
    const body = buildAdUpdatePayload(input);
    if (!skipRemote && strategy === "update") {
      // Only validate_only when we haven't already mutated via repoint/replace.
      try {
        await metaApiCall<{ success?: boolean }>({
          method: "POST",
          path: effectiveAdId,
          params: "",
          body: withValidateOnly(body),
          accessToken: input.accessToken,
        });
      } catch (error) {
        return failUpdate(issuesFromError(error, "validate_only", "ad", subcodeSuggestion));
      }
    }
    try {
      await metaApiCall<{ success?: boolean }>({
        method: "POST",
        path: effectiveAdId,
        params: "",
        body,
        accessToken: input.accessToken,
      });
    } catch (error) {
      return failUpdate(issuesFromError(error, "update", "ad", subcodeSuggestion));
    }
  }

  const data: UpdateData = {
    id: effectiveAdId,
    strategy,
    previousId: input.adId,
    ...(strategy === "replace_paused" && { replacedById: effectiveAdId, pausedId }),
    ...(creativeId && { creativeId }),
  };
  return okUpdate(data, warnings);
}
