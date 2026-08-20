export { buildClientPerformanceReport } from "./build-report";
export { PerformanceReportError } from "./errors";
export {
  PERFORMANCE_DATE_PRESETS,
  parseReportFilters,
  type PerformanceReportFilters,
} from "./filters";
export { assertMatReportAuthorized } from "./internal-auth";
export {
  getReportClientByEmail,
  getReportClientByUserId,
} from "./client";
export {
  buildCampaignWorkspaceUrl,
  buildPerformanceReportUrl,
  getBackofficeBaseUrl,
} from "./url";
export type { ClientPerformanceReportV1 } from "./types";
