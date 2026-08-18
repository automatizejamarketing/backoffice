import "server-only";

import type { VindiClient } from "./client";
import {
  getSettledVindiAmounts,
  unwrapVindiCharge,
  type SettledVindiAmounts,
} from "./settlement";

export const VINDI_SETTLEMENT_MISSING_LOG = "[vindi-settlement] missing";

export type VindiSettlementMissingReason =
  | "net_not_reported"
  | "charge_not_found"
  | "vindi_request_failed";

export async function getVindiSettlementByChargeId(
  chargeId: string,
  client: VindiClient,
): Promise<SettledVindiAmounts | null> {
  try {
    const payload = await client.request<unknown>({
      method: "GET",
      path: `/v1/charges/${chargeId}`,
    });
    const charge = unwrapVindiCharge(payload);
    if (!charge) {
      console.warn(VINDI_SETTLEMENT_MISSING_LOG, {
        reason: "charge_not_found" satisfies VindiSettlementMissingReason,
        vindiChargeId: chargeId,
      });
      return null;
    }

    const settled = getSettledVindiAmounts(charge);
    if (!settled) {
      console.warn(VINDI_SETTLEMENT_MISSING_LOG, {
        reason: "net_not_reported" satisfies VindiSettlementMissingReason,
        vindiChargeId: chargeId,
        status: charge.status ?? null,
      });
      return null;
    }

    return settled;
  } catch (error) {
    console.warn(VINDI_SETTLEMENT_MISSING_LOG, {
      reason: "vindi_request_failed" satisfies VindiSettlementMissingReason,
      vindiChargeId: chargeId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
