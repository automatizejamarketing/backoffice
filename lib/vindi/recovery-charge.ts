import type {
  PlanType,
  VindiSubscriptionPaymentMethod,
} from "@/lib/db/schema";
import { VINDI_PIX_QR_TTL_MS } from "./backoffice-pix";
import type { VindiClient } from "./client";
import {
  reissueVindiRecoveryChargeAsPix,
  retryVindiRecoveryCharge,
  vindiRecoveryRetryAllowed,
  VindiRecoveryRetryNotAllowedError,
} from "./recovery";

export const VINDI_RECOVERY_RETRY_ACTION = "retry_vindi_recovery";
export const VINDI_RECOVERY_REISSUE_ACTION = "reissue_vindi_recovery";

export type VindiBackofficeRecoveryMode = "retry" | "reissue";

export type VindiBackofficeRecoveryLink = {
  id: string;
  emvPayload: string;
  vindiBillId: string | null;
  vindiChargeId: string | null;
  amount: number;
  expiresAt: Date;
};

export type VindiBackofficeRecoverySnapshot = {
  userId: string;
  subscription: {
    id: string;
    provider: string;
    status: string;
    planType: PlanType;
    vindiPaymentMethod: VindiSubscriptionPaymentMethod | null;
  } | null;
  failedPayment: {
    vindiChargeId: string | null;
    vindiBillId: string | null;
    amount: number;
    currency: string;
    failureReason: string | null;
    createdAt: Date;
  } | null;
  pendingRecoveryLink: VindiBackofficeRecoveryLink | null;
};

export type VindiBackofficeRecoveryStore = {
  getSnapshot(userId: string): Promise<VindiBackofficeRecoverySnapshot | null>;
  persistRecoveryLink(input: {
    userId: string;
    planType: PlanType;
    amount: number;
    emvPayload: string;
    vindiBillId: string;
    vindiChargeId: string;
    expiresAt: Date;
    now: Date;
  }): Promise<VindiBackofficeRecoveryLink>;
  writeAudit(entry: {
    adminEmail: string;
    targetUserId: string;
    action:
      | typeof VINDI_RECOVERY_RETRY_ACTION
      | typeof VINDI_RECOVERY_REISSUE_ACTION;
    fieldName: string;
    oldValue: string | null;
    newValue: string;
    note: string | null;
  }): Promise<void>;
};

export type VindiBackofficeRecoveryResult =
  | {
      ok: true;
      mode: "retry";
      chargeId: string;
      chargeStatus: string | null;
    }
  | {
      ok: true;
      mode: "reissue";
      reused: boolean;
      chargeId: string;
      billId: string | null;
      emvPayload: string;
      amountCentavos: number;
      expiresAt: Date;
    }
  | {
      ok: false;
      error:
        | "user_not_found"
        | "no_vindi_subscription"
        | "subscription_not_recoverable"
        | "no_failed_charge"
        | "retry_not_allowed";
    };

export async function recoverVindiPayment(input: {
  client: VindiClient;
  store: VindiBackofficeRecoveryStore;
  userId: string;
  adminEmail: string;
  mode: VindiBackofficeRecoveryMode;
  pixMethodCode: string;
  now: Date;
}): Promise<VindiBackofficeRecoveryResult> {
  const snapshot = await input.store.getSnapshot(input.userId);
  if (!snapshot) {
    return { ok: false, error: "user_not_found" };
  }
  if (
    !snapshot.subscription ||
    snapshot.subscription.provider !== "vindi"
  ) {
    return { ok: false, error: "no_vindi_subscription" };
  }
  if (
    snapshot.subscription.status !== "past_due" &&
    snapshot.subscription.status !== "unpaid"
  ) {
    return { ok: false, error: "subscription_not_recoverable" };
  }

  const chargeId = snapshot.failedPayment?.vindiChargeId;
  if (!chargeId) {
    return { ok: false, error: "no_failed_charge" };
  }

  if (input.mode === "retry") {
    if (!vindiRecoveryRetryAllowed(snapshot.subscription.vindiPaymentMethod)) {
      return { ok: false, error: "retry_not_allowed" };
    }

    try {
      const retried = await retryVindiRecoveryCharge({
        client: input.client,
        chargeId,
        vindiPaymentMethod: snapshot.subscription.vindiPaymentMethod,
      });
      await input.store.writeAudit({
        adminEmail: input.adminEmail,
        targetUserId: input.userId,
        action: VINDI_RECOVERY_RETRY_ACTION,
        fieldName: "payment_status",
        oldValue: "failed",
        newValue: retried.status ?? "pending",
        note: `Retried Vindi charge ${chargeId}.`,
      });
      return {
        ok: true,
        mode: "retry",
        chargeId,
        chargeStatus: retried.status,
      };
    } catch (error) {
      if (error instanceof VindiRecoveryRetryNotAllowedError) {
        return { ok: false, error: "retry_not_allowed" };
      }
      throw error;
    }
  }

  if (isReusableRecoveryLink(snapshot.pendingRecoveryLink, snapshot.failedPayment, input.now)) {
    await input.store.writeAudit({
      adminEmail: input.adminEmail,
      targetUserId: input.userId,
      action: VINDI_RECOVERY_REISSUE_ACTION,
      fieldName: "vindi_payment_link",
      oldValue: chargeId,
      newValue: snapshot.pendingRecoveryLink.vindiChargeId ?? chargeId,
      note: `Reused pending Vindi recovery Pix ${snapshot.pendingRecoveryLink.id}.`,
    });
    return {
      ok: true,
      mode: "reissue",
      reused: true,
      chargeId: snapshot.pendingRecoveryLink.vindiChargeId ?? chargeId,
      billId: snapshot.pendingRecoveryLink.vindiBillId,
      emvPayload: snapshot.pendingRecoveryLink.emvPayload,
      amountCentavos: snapshot.pendingRecoveryLink.amount,
      expiresAt: snapshot.pendingRecoveryLink.expiresAt,
    };
  }

  const reissued = await reissueVindiRecoveryChargeAsPix({
    client: input.client,
    chargeId,
    pixMethodCode: input.pixMethodCode,
  });
  const expiresAt = new Date(input.now.getTime() + VINDI_PIX_QR_TTL_MS);
  await input.store.persistRecoveryLink({
    userId: input.userId,
    planType: snapshot.subscription.planType,
    amount: reissued.amountCentavos,
    emvPayload: reissued.emvPayload,
    vindiBillId: reissued.billId,
    vindiChargeId: reissued.chargeId,
    expiresAt,
    now: input.now,
  });
  await input.store.writeAudit({
    adminEmail: input.adminEmail,
    targetUserId: input.userId,
    action: VINDI_RECOVERY_REISSUE_ACTION,
    fieldName: "vindi_payment_link",
    oldValue: chargeId,
    newValue: reissued.chargeId,
    note: `Reissued Vindi charge ${chargeId} as Pix ${reissued.chargeId}.`,
  });

  return {
    ok: true,
    mode: "reissue",
    reused: false,
    chargeId: reissued.chargeId,
    billId: reissued.billId,
    emvPayload: reissued.emvPayload,
    amountCentavos: reissued.amountCentavos,
    expiresAt,
  };
}

function isReusableRecoveryLink(
  link: VindiBackofficeRecoveryLink | null,
  failedPayment: VindiBackofficeRecoverySnapshot["failedPayment"],
  now: Date,
): link is VindiBackofficeRecoveryLink {
  if (!link || link.expiresAt <= now) return false;
  if (failedPayment?.vindiBillId && link.vindiBillId === failedPayment.vindiBillId) {
    return true;
  }
  return Boolean(
    failedPayment?.vindiChargeId &&
      link.vindiChargeId === failedPayment.vindiChargeId,
  );
}
