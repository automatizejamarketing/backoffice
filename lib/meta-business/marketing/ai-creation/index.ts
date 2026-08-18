/**
 * Criação de campanha com IA — the module's PUBLIC API, and the one seam its tests enter through
 * (ADR 0022).
 *
 * Everything else here — the validation rule, the ranking, the mold read, the tree builder — is an
 * implementation detail behind these functions, free to be refactored without rewriting a test.
 *
 *   scanAccountForMold    → which ad in this account, if any, proved something worth copying
 *   planDuplicatedCampaign → what exactly would be duplicated, plus Meta's own objections
 *   createPlannedCampaign  → create it (by filtered duplication, ADR 0023)
 */
export {
  scanAccountForMold,
  SALES_CAMPAIGN_OBJECTIVES,
  type ScanAccountOptions,
  type ScanResult,
} from "./scan-account";
export {
  MoldNotFoundError,
  type ReviewSummary,
} from "./plan-campaign";
export {
  createPlannedCampaign,
  type PublishResult,
  type PublishedCampaign,
  type PublishFailure,
} from "./publish-campaign";
export {
  needsTexts,
  ADVISED_MIN_DAILY_BUDGET,
  DEFAULT_DAILY_BUDGET,
  DEFAULT_FLIGHT_DAYS,
  type PlanAnswers,
  type PlanMedia,
  type PlanTexts,
} from "./build-tree";
export {
  createDuplicatedCampaign,
  planDuplicatedCampaign,
  type DuplicationPlanResult,
  type DuplicationPublishResult,
} from "./duplicate-campaign";
export { listProvenAdsInCampaign, provenAdIds, type ProvenAdRef } from "./proven-ads";
export type { MoldRef } from "./pick-mold";
export type { MoldKind } from "./validation-rules";
