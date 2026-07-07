/**
 * Object-ownership guard for the unified UPDATE/DELETE surface (BUG-001 / ADR 0013).
 *
 * Account ACCESS (ADR 0011) proves only that the user can act on an account — NOT
 * that the target object lives there. Meta resolves campaign/ad-set/ad/creative
 * ids GLOBALLY within the token scope, so a read / `validate_only` / write on a
 * bare id succeeds even when the account the caller DECLARED owns a different
 * object. Before any mutation we compare the object's own `account_id` against the
 * resolved account and refuse on mismatch.
 *
 * Cost: on the common edit path the snapshot already carries `account_id` (added
 * to the read field lists), so this is ZERO extra calls. On the status/name-only
 * fast path (which skips the snapshot read) we fetch ONLY `account_id` — one cheap
 * GET that stops a cross-account pause/archive/rename from landing on the wrong
 * account.
 */

import { metaApiCall } from "@/lib/meta-business/api";
import {
  isSameAccount,
  stripActPrefix,
} from "@/lib/meta-business/account-match";
import { issuesFromError } from "../creation/normalize";
import { type CreateIssue, type CreateLevel, localIssue } from "../creation/types";
import { subcodeSuggestion } from "./validation";

// Re-exported so existing importers (and the unit test) keep their import path;
// the comparison itself now lives in the shared `account-match` module (ADR 0013).
export { isSameAccount };

/**
 * Return ownership issues (empty = ok) for an object the caller wants to mutate.
 * Pass `snapshotAccountId` when a snapshot was already read (no extra call); omit
 * it on the fast path and a single `fields=account_id` GET is done here.
 *
 * Fail-open only when Meta returns no `account_id` (can't disprove ownership) or
 * when no account was declared — never silently allow a proven mismatch.
 */
export async function ensureObjectInAccount(args: {
  objectId: string;
  level: CreateLevel;
  /** The resolved, access-validated account the caller declared (bare or act_). */
  expectedAccountId: string | undefined;
  /** `account_id` from an already-fetched snapshot, if available. */
  snapshotAccountId?: string;
  accessToken: string;
}): Promise<CreateIssue[]> {
  const { objectId, level, expectedAccountId, accessToken } = args;
  // No declared account to check against → nothing to assert (back-compat).
  if (!expectedAccountId) return [];

  let owner = args.snapshotAccountId;
  if (!owner) {
    try {
      const res = await metaApiCall<{ account_id?: string }>({
        domain: "FACEBOOK",
        method: "GET",
        path: objectId,
        params: "fields=account_id",
        accessToken,
      });
      owner = res.account_id;
    } catch (error) {
      return issuesFromError(error, "validate_only", level, subcodeSuggestion);
    }
  }

  if (owner && !isSameAccount(owner, expectedAccountId)) {
    return [
      localIssue(
        level,
        "OBJECT_NOT_IN_ACCOUNT",
        `O objeto ${objectId} pertence à conta ${stripActPrefix(owner)}, não à conta ${stripActPrefix(expectedAccountId)} informada.`,
        "Use a conta correta — a mesma onde você resolveu o id do objeto via findObjects (ou troque a conta selecionada).",
      ),
    ];
  }
  return [];
}
