/**
 * Shared contract for the unified Meta creation primitives (createCampaign /
 * createAdSet / createAd / createCampaignTree).
 *
 * Design (ADR 0009):
 * - Primitives RETURN a discriminated {@link CreateResult}; they do NOT throw for
 *   known/validation failures. Unexpected (network) errors become a single
 *   `transient` issue (see ./normalize).
 * - Local validation COLLECTS ALL violations at once (so the AI can fix everything
 *   in one round-trip); Meta (`validate_only` / real create) returns one at a time.
 * - Every {@link CreateIssue} carries a human `reason` AND an actionable
 *   `suggestion`, so the AI assistant can self-correct.
 *
 * This module is intentionally PURE (no Meta/observability imports) so the rules
 * engine and contract can be unit-tested in isolation. The Graph-error → issue
 * adapter lives in ./normalize.
 */

/**
 * Where a failure was caught. `local` = our rules (zero Meta calls).
 * `update` is the real-mutation stage for the update primitives (ADR 0010) —
 * the sibling of `create`, so create and update share one issue shape.
 */
export type CreateStage = "local" | "validate_only" | "create" | "update";

/** Which Meta object the issue concerns. */
export type CreateLevel = "campaign" | "adset" | "ad" | "creative";

/**
 * A single machine-readable creation failure. `code` is our rule id
 * (e.g. `BID_AMOUNT_REQUIRED`) for local issues, or `META_<code>[_<subcode>]`
 * for Meta-side rejections.
 */
export type CreateIssue = {
  stage: CreateStage;
  level: CreateLevel;
  code: string;
  /** Why it failed (pt-BR, human readable). */
  reason: string;
  /** What to do to fix it — actionable by the AI assistant. */
  suggestion: string;
  /** Offending field path, when known (e.g. `["bid_amount"]`). */
  field?: string[];
  metaCode?: number;
  metaSubcode?: number;
  /** Whether a Meta rejection is retryable (rate limit / 5xx). */
  transient?: boolean;
};

/**
 * Result of a creation primitive. On success carries the created `id`; on failure
 * carries every {@link CreateIssue} found. `warnings` are non-fatal advisories
 * (e.g. `include_recommendations` from `validate_only`).
 */
export type CreateResult<T = { id: string }> =
  | { ok: true; id: string; data: T; warnings?: CreateIssue[] }
  | { ok: false; issues: CreateIssue[] };

/**
 * No-write result of a primitive run in preview mode: validation only (local +
 * Meta `validate_only`), reporting the compiled payload that WOULD be sent. This
 * is the AI assistant's "preview" before the user confirms a commit (ADR 0009).
 */
export type PreviewResult =
  | { ok: true; payload: Record<string, string>; warnings?: CreateIssue[] }
  | { ok: false; issues: CreateIssue[] };

/**
 * How far a primitive runs:
 * - `preview` — local validation + Meta `validate_only`, then STOP (no object created).
 * - `commit`  — local validation + `validate_only` + the real create.
 * - `commit_unchecked` — local validation + real create, skipping `validate_only`
 *   (trusted callers / parity-sensitive wizard paths that want byte-identical
 *   single-call behaviour).
 */
export type CreateMode = "preview" | "commit" | "commit_unchecked";

export type BaseCreateOptions = {
  /** Defaults to `commit`. */
  mode?: CreateMode;
};

// ───────────────────────── helpers ─────────────────────────

export function ok<T>(id: string, data: T, warnings?: CreateIssue[]): CreateResult<T> {
  return warnings && warnings.length
    ? { ok: true, id, data, warnings }
    : { ok: true, id, data };
}

export function fail(issues: CreateIssue[]): { ok: false; issues: CreateIssue[] } {
  return { ok: false, issues };
}

/** Build a local (pre-Meta) validation issue. */
export function localIssue(
  level: CreateLevel,
  code: string,
  reason: string,
  suggestion: string,
  field?: string[],
): CreateIssue {
  return field
    ? { stage: "local", level, code, reason, suggestion, field }
    : { stage: "local", level, code, reason, suggestion };
}

/**
 * Merge a caller-supplied escape-hatch object into a Meta payload. Objects/arrays
 * are JSON-stringified (Meta form encoding); primitives are stringified as-is.
 * Lets the primitives accept ANY Meta field we have not modeled (ADR 0009).
 */
export function mergeExtraFields(
  params: URLSearchParams,
  extra?: Record<string, unknown>,
): void {
  if (!extra) return;
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null) continue;
    params.set(
      key,
      typeof value === "object" ? JSON.stringify(value) : String(value),
    );
  }
}
