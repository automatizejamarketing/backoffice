import type { CreateIssue } from "../creation/types";

type AudienceSelectionInput = {
  adAccountId: string;
  accessToken: string;
  customerId?: string;
  ids?: readonly string[];
};

/**
 * The campaign engine is also imported by client-safe review code and by
 * tests that exercise its public API. Keep the database-backed revalidation
 * behind this lazy boundary so those imports do not load `server-only` or the
 * customer-file Postgres adapter.
 *
 * The server validators remain the source of truth when a selection exists:
 * they reread both the Meta audience library and the customer-file import
 * history immediately before planning or activating a campaign.
 */
export async function validateAudienceInclusionSelection(
  input: AudienceSelectionInput,
): Promise<CreateIssue[]> {
  if (input.ids === undefined || (Array.isArray(input.ids) && input.ids.length === 0)) {
    return [];
  }

  const { validateAudienceInclusionSelection: validate } = await import(
    "./audience-inclusions-server"
  );
  return validate(input);
}

export async function validateAudienceExclusionSelection(
  input: AudienceSelectionInput,
): Promise<CreateIssue[]> {
  if (input.ids === undefined || (Array.isArray(input.ids) && input.ids.length === 0)) {
    return [];
  }

  const { validateAudienceExclusionSelection: validate } = await import(
    "./audience-exclusions-server"
  );
  return validate(input);
}
