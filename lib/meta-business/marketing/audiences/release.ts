/**
 * Shared operational switch for the customer-list import journey. It defaults
 * on for every marketing-enabled customer and does not remove existing data.
 */
export const CUSTOMER_AUDIENCE_IMPORTS_ENABLED_ENV = "CUSTOMER_AUDIENCE_IMPORTS_ENABLED";

export function customerAudienceImportsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CUSTOMER_AUDIENCE_IMPORTS_ENABLED_ENV]?.trim().toLowerCase() !== "false";
}
