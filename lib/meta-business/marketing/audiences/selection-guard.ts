import { customerFileDurableStore } from "@/lib/customer-file/postgres";
import type { CustomerFileDurableStore } from "@/lib/customer-file/types";
import {
  checkAudienceSelectionFromHistory,
  type AudienceSelectionCheck,
} from "./selection";

export type { AudienceSelectionBlock, AudienceSelectionPlacement, AudienceSelectionCheck } from "./selection";

type AudienceHistoryStore = Pick<CustomerFileDurableStore, "getLatestImportsForAudiences">;

/**
 * Revalidates advanced audience selections immediately before an ad-set write.
 * Missing local history is intentionally allowed; only a known compromised
 * import is a local blocker.
 */
export async function checkAudienceSelectionAvailability(input: {
  customerId: string;
  adAccountId: string;
  includedAudienceIds?: ReadonlyArray<string>;
  excludedAudienceIds?: ReadonlyArray<string>;
  store?: AudienceHistoryStore;
}): Promise<AudienceSelectionCheck> {
  const selections = [
    ...(input.includedAudienceIds ?? []),
    ...(input.excludedAudienceIds ?? []),
  ].filter(Boolean);
  if (selections.length === 0) return { ok: true };

  const history = await (input.store ?? customerFileDurableStore()).getLatestImportsForAudiences(
    input.customerId,
    [...new Set(selections)],
    input.adAccountId,
  );
  return checkAudienceSelectionFromHistory({
    includedAudienceIds: input.includedAudienceIds,
    excludedAudienceIds: input.excludedAudienceIds,
    history,
  });
}
