/**
 * Shared contract for the unified Meta UPDATE primitives (updateCampaign /
 * updateAdSet / updateAd) — the sibling surface of the creation primitives
 * (ADR 0009 / ADR 0010).
 *
 * Design notes:
 * - We REUSE the creation contract ({@link CreateIssue} / {@link CreateResult} /
 *   {@link PreviewResult}) so the AI assistant sees a byte-identical ok/issues
 *   shape for both create and update and can self-correct from `reason` +
 *   `suggestion`. The only addition is the `update` stage (in creation/types)
 *   and the {@link UpdateData} success payload below (carries the mutation
 *   `strategy` for the creative replace-paused case).
 * - Updates are SPARSE: only the provided fields change. Each primitive reads
 *   the current object once (or accepts a pre-fetched snapshot) so conditional
 *   rules (budget XOR, bid↔bid_amount, dayparting↔lifetime, …) validate against
 *   the EFFECTIVE state (current merged with the requested change).
 */

import type {
  CreateIssue,
  CreateMode,
  CreateResult,
  PreviewResult,
} from "../creation/types";

export type { CreateIssue, PreviewResult } from "../creation/types";

/**
 * How a mutation was carried out:
 * - `update` — a plain in-place `POST /{id}` (the normal path).
 * - `repoint` — an ad's `creative` reference was swapped in place to a new
 *   creative (creative-content edit on an editable ad).
 * - `replace_paused` — the in-place repoint was refused by Meta (ad active /
 *   has engagement), so a paused copy carrying the new creative was created in
 *   the same ad set and the original was paused. The ad id therefore CHANGES.
 */
export type UpdateStrategy = "update" | "repoint" | "replace_paused";

/**
 * Success payload of an update primitive. `id` is the object that now carries
 * the user's intent: the same id for an in-place update/repoint, or the NEW ad
 * id for `replace_paused` (with the original surfaced as `pausedId`).
 */
export type UpdateData = {
  /** The object whose state now reflects the requested change. */
  id: string;
  strategy: UpdateStrategy;
  /** The id originally targeted by the caller (always present). */
  previousId: string;
  /** `replace_paused`: the new ad id that carries the change (= `id`). */
  replacedById?: string;
  /** `replace_paused`: the original ad id that was paused. */
  pausedId?: string;
  /** A creative that was (re)built during the update (repoint/replace). */
  creativeId?: string;
};

/** Result of an update primitive — the creation contract specialized to {@link UpdateData}. */
export type UpdateResult = CreateResult<UpdateData>;

/**
 * How far an update primitive runs (mirrors {@link CreateMode}):
 * - `preview` — local validation + Meta `validate_only`, then STOP (no write).
 * - `commit` — local validation + `validate_only` + the real update.
 * - `commit_unchecked` — local validation + real update, skipping `validate_only`.
 */
export type UpdateMode = CreateMode;

export type BaseUpdateOptions = {
  /** Defaults to `commit`. */
  mode?: UpdateMode;
};

// ───────────────────────── helpers ─────────────────────────

export function okUpdate(
  data: UpdateData,
  warnings?: CreateIssue[],
): UpdateResult {
  return warnings && warnings.length
    ? { ok: true, id: data.id, data, warnings }
    : { ok: true, id: data.id, data };
}

export function failUpdate(
  issues: CreateIssue[],
): { ok: false; issues: CreateIssue[] } {
  return { ok: false, issues };
}

/** Append `execution_options: ["validate_only"]` to an update body. */
export function withValidateOnly(body: URLSearchParams): URLSearchParams {
  const v = new URLSearchParams(body);
  v.set("execution_options", JSON.stringify(["validate_only"]));
  return v;
}

/** "act_<id>" or a bare numeric id → "act_<id>". */
export function formatAccountId(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}
