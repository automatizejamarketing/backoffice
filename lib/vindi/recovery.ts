import type { VindiSubscriptionPaymentMethod } from "@/lib/db/schema";
import type { VindiClient } from "./client";
import { vindiAmountToCentavos } from "./money";
import {
  parseVindiPixEmv,
  vindiPixEmvUnknownLogFields,
} from "./pix-emv";

export function vindiRecoveryRetryAllowed(
  method: VindiSubscriptionPaymentMethod | null | undefined,
): boolean {
  return method === "credit_card";
}

export class VindiRecoveryRetryNotAllowedError extends Error {
  constructor() {
    super("Retry is only available for a card charge");
    this.name = "VindiRecoveryRetryNotAllowedError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resourceId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function unwrapCharge(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  if (isRecord(payload.charge)) return payload.charge;
  return payload;
}

export async function retryVindiRecoveryCharge(input: {
  client: VindiClient;
  chargeId: string;
  vindiPaymentMethod: VindiSubscriptionPaymentMethod | null | undefined;
}): Promise<{ status: string | null }> {
  if (!vindiRecoveryRetryAllowed(input.vindiPaymentMethod)) {
    throw new VindiRecoveryRetryNotAllowedError();
  }

  const payload = await input.client.request<unknown>({
    method: "POST",
    path: `/v1/charges/${input.chargeId}/charge`,
  });
  const charge = unwrapCharge(payload);
  return {
    status: typeof charge?.status === "string" ? charge.status : null,
  };
}

export type ReissuedVindiRecoveryPix = {
  billId: string;
  chargeId: string;
  amountCentavos: number;
  emvPayload: string;
};

export async function reissueVindiRecoveryChargeAsPix(input: {
  client: VindiClient;
  chargeId: string;
  pixMethodCode: string;
  log?: (event: string, fields: Record<string, unknown>) => void;
}): Promise<ReissuedVindiRecoveryPix> {
  const payload = await input.client.request<unknown>({
    method: "POST",
    path: `/v1/charges/${input.chargeId}/reissue`,
    body: { payment_method_code: input.pixMethodCode },
  });

  const charge = unwrapCharge(payload);
  if (!charge) {
    throw new Error("Vindi reissue did not return a charge");
  }

  const bill = isRecord(charge.bill) ? charge.bill : null;
  const billId = resourceId(bill?.id);
  const chargeId = resourceId(charge.id);
  const amountSource =
    typeof charge.amount === "string" || typeof charge.amount === "number"
      ? charge.amount
      : bill &&
          (typeof bill.amount === "string" || typeof bill.amount === "number")
        ? bill.amount
        : null;
  const parsedEmv = parseVindiPixEmv(payload);
  if (!parsedEmv.ok) {
    input.log?.("unknown_pix_emv_shape", vindiPixEmvUnknownLogFields(parsedEmv));
    throw new Error("Vindi Pix QR payload was not found");
  }
  if (!billId || !chargeId || amountSource == null) {
    throw new Error("Vindi reissue is missing bill, charge, or amount");
  }

  return {
    billId,
    chargeId,
    amountCentavos: vindiAmountToCentavos(amountSource),
    emvPayload: parsedEmv.emvPayload,
  };
}
