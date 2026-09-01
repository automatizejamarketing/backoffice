import type { PlanType } from "@/lib/db/schema";
import {
  decideVindiPaidOutOfBand,
  VINDI_PAID_OUT_OF_BAND_ACTION,
  type VindiPaidOutOfBandOpenLink,
} from "./backoffice-pix";
import type { VindiClient } from "./client";
import { deleteVindiBill } from "./backoffice-pix-charge";

export type VindiPaidOutOfBandSnapshot = {
  userId: string;
  expirationDate: Date | null;
  planType: PlanType | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  openLinks: VindiPaidOutOfBandOpenLink[];
  failedPaymentBillId: string | null;
};

export type VindiPaidOutOfBandStore = {
  getSnapshot(userId: string): Promise<VindiPaidOutOfBandSnapshot | null>;
  setExpiration(userId: string, expiration: Date): Promise<void>;
  markLinksCanceled(ids: string[], now: Date): Promise<void>;
  writeAudit(entry: {
    adminEmail: string;
    targetUserId: string;
    action: typeof VINDI_PAID_OUT_OF_BAND_ACTION;
    fieldName: string;
    oldValue: string | null;
    newValue: string;
    note: string | null;
  }): Promise<void>;
};

export type VindiPaidOutOfBandResult =
  | {
      ok: true;
      billIds: string[];
      newExpiration: Date;
      auditAction: typeof VINDI_PAID_OUT_OF_BAND_ACTION;
    }
  | {
      ok: false;
      error: "user_not_found" | "no_open_bill" | "no_plan";
    };

export async function markVindiPaidOutOfBand(input: {
  client: VindiClient;
  store: VindiPaidOutOfBandStore;
  userId: string;
  adminEmail: string;
  now: Date;
}): Promise<VindiPaidOutOfBandResult> {
  const snapshot = await input.store.getSnapshot(input.userId);
  if (!snapshot) {
    return { ok: false, error: "user_not_found" };
  }

  const decision = decideVindiPaidOutOfBand({
    planType: snapshot.planType,
    currentExpiration: snapshot.expirationDate,
    openLinks: snapshot.openLinks,
    failedPaymentBillId: snapshot.failedPaymentBillId,
    now: input.now,
  });
  if (!decision.ok) {
    return { ok: false, error: decision.reason };
  }

  // Anulação de MELHOR ESFORÇO: o gateway pode recusar o cancelamento de uma
  // fatura Pix (no sandbox recusa sempre — defeito #9 da rodada 1). O registro
  // do admin vale mais que a anulação: seguimos com a extensão, logamos alto e
  // a fatura que sobrar viva, se paga, é honrada pela reconciliação do webhook.
  const canceledBillIds: string[] = [];
  const survivingBillIds: string[] = [];
  for (const billId of decision.billIds) {
    try {
      await deleteVindiBill(input.client, billId);
      canceledBillIds.push(billId);
    } catch (error) {
      survivingBillIds.push(billId);
      console.warn("[vindi/paid-out-of-band] bill_cancel_failed", {
        billId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await input.store.markLinksCanceled(decision.linkIds, input.now);
  await input.store.setExpiration(input.userId, decision.newExpiration);

  await input.store.writeAudit({
    adminEmail: input.adminEmail,
    targetUserId: input.userId,
    action: decision.auditAction,
    fieldName: "expiration_date",
    oldValue: snapshot.expirationDate?.toISOString() ?? null,
    newValue: decision.newExpiration.toISOString(),
    note: survivingBillIds.length
      ? `Canceled Vindi bills: ${canceledBillIds.join(", ") || "nenhuma"}; o gateway recusou anular: ${survivingBillIds.join(", ")}`
      : `Canceled Vindi bills: ${canceledBillIds.join(", ")}`,
  });

  return {
    ok: true,
    billIds: decision.billIds,
    newExpiration: decision.newExpiration,
    auditAction: decision.auditAction,
  };
}
