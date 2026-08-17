import { vindiAmountToCentavos } from "./money";

// What the settlement reconciler (D7 / anexo §3.5) reads for Vindi. The
// Recorrência charge schema does not document a stable net/fee pair — checklist
// §11 item (7) is still open — so this module only accepts amounts the payload
// actually published. A charge with only `amount` is not settled: inventing
// net = gross would unblock referral commissions on a number we do not have.

export type VindiChargeSettlementSource = {
  id?: number | string;
  amount?: string | number;
  status?: string;
  net_amount?: string | number | null;
  fee_amount?: string | number | null;
  fee?: string | number | null;
  last_transaction?: {
    status?: string;
    net_amount?: string | number | null;
    fee_amount?: string | number | null;
    fee?: string | number | null;
    gateway_response_fields?:
      | Record<string, string | number | undefined>
      | string
      | null;
  } | null;
};

export type VindiSettlementAmounts = {
  grossAmount: number | null;
  netAmount: number | null;
  feeAmount: number | null;
};

export type SettledVindiAmounts = {
  grossAmount: number;
  netAmount: number;
  feeAmount: number | null;
};

const NET_FIELD_KEYS = [
  "net_amount",
  "net",
  "valor_liquido",
  "net_received_amount",
] as const;

const FEE_FIELD_KEYS = [
  "fee_amount",
  "fee",
  "taxa",
  "gateway_fee",
  "processing_fee",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readVindiCentavos(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  try {
    return vindiAmountToCentavos(value);
  } catch {
    return null;
  }
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function gatewayResponseFields(
  value: VindiChargeSettlementSource["last_transaction"],
): Record<string, unknown> {
  const raw = value?.gateway_response_fields;
  if (typeof raw === "string") return parseJsonObject(raw) ?? {};
  return isRecord(raw) ? raw : {};
}

function firstCentavos(
  source: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): number | null {
  if (!source) return null;
  for (const key of keys) {
    const amount = readVindiCentavos(source[key]);
    if (amount !== null) return amount;
  }
  return null;
}

export function unwrapVindiCharge(
  payload: unknown,
): VindiChargeSettlementSource | null {
  if (!isRecord(payload)) return null;
  const charge = isRecord(payload.charge) ? payload.charge : payload;
  if (charge.id == null) return null;
  return charge as VindiChargeSettlementSource;
}

export function getVindiSettlementAmounts(
  charge: VindiChargeSettlementSource,
): VindiSettlementAmounts {
  const fields = gatewayResponseFields(charge.last_transaction);
  const transaction = charge.last_transaction
    ? {
        net_amount: charge.last_transaction.net_amount,
        fee_amount: charge.last_transaction.fee_amount,
        fee: charge.last_transaction.fee,
      }
    : null;

  const grossAmount = readVindiCentavos(charge.amount);
  const netAmount =
    readVindiCentavos(charge.net_amount) ??
    firstCentavos(transaction, NET_FIELD_KEYS) ??
    firstCentavos(fields, NET_FIELD_KEYS);
  const feeAmount =
    readVindiCentavos(charge.fee_amount) ??
    readVindiCentavos(charge.fee) ??
    firstCentavos(transaction, FEE_FIELD_KEYS) ??
    firstCentavos(fields, FEE_FIELD_KEYS);

  return { grossAmount, netAmount, feeAmount };
}

export function getSettledVindiAmounts(
  charge: VindiChargeSettlementSource,
): SettledVindiAmounts | null {
  const amounts = getVindiSettlementAmounts(charge);
  if (amounts.grossAmount === null) return null;

  if (amounts.netAmount !== null) {
    return {
      grossAmount: amounts.grossAmount,
      netAmount: amounts.netAmount,
      feeAmount: amounts.feeAmount,
    };
  }

  if (amounts.feeAmount === null) return null;

  return {
    grossAmount: amounts.grossAmount,
    netAmount: amounts.grossAmount - amounts.feeAmount,
    feeAmount: amounts.feeAmount,
  };
}
