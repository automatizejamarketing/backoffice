import type {
  PlanType,
  VindiSubscriptionPaymentMethod,
} from "@/lib/db/schema";
import { VindiApiError, type VindiClient } from "./client";
import { deleteVindiBill } from "./backoffice-pix-charge";
import {
  canCancelVindiSubscription,
  decideVindiCancel,
  vindiCardTrialCancelEffects,
  vindiPaidCancelEffects,
  type VindiCancelMode,
  type VindiPaidCancelEffects,
} from "./subscription-cancel";

export const VINDI_CANCEL_AUDIT_ACTION = "cancel_vindi_subscription";

export type VindiBackofficeCancelSnapshot = {
  userId: string;
  expirationDate: Date | null;
  subscription: {
    id: string;
    provider: string;
    status: string;
    planType: PlanType;
    vindiPaymentMethod: VindiSubscriptionPaymentMethod | null;
    vindiSubscriptionId: string | null;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date | null;
    currentPeriodStart: Date | null;
    vindiConsentAuthorizedAt: Date | null;
  } | null;
  openLinks: Array<{
    id: string;
    vindiBillId: string | null;
    status: string;
  }>;
};

export type VindiBackofficeCancelStore = {
  getSnapshot(userId: string): Promise<VindiBackofficeCancelSnapshot | null>;
  applyPaidCancel(input: {
    subscriptionId: string;
    effects: VindiPaidCancelEffects;
    now: Date;
  }): Promise<void>;
  applyTrialCancel(input: {
    userId: string;
    subscriptionId: string;
    now: Date;
  }): Promise<void>;
  cancelPendingPlanChanges(userId: string, now: Date): Promise<void>;
  markLinksSuperseded(ids: string[], now: Date): Promise<void>;
  writeEvent(entry: {
    userId: string;
    subscriptionId: string;
    eventType: "canceled";
    fromPlan: PlanType;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  writeAudit(entry: {
    adminEmail: string;
    targetUserId: string;
    action: typeof VINDI_CANCEL_AUDIT_ACTION;
    fieldName: string;
    oldValue: string | null;
    newValue: string;
    note: string | null;
  }): Promise<void>;
};

export type VindiBackofficeCancelResult =
  | {
      ok: true;
      mode: VindiCancelMode;
      inSchedulingWindow: boolean;
      accessUntil: Date;
    }
  | {
      ok: false;
      error:
        | "user_not_found"
        | "no_vindi_subscription"
        | "already_scheduled";
    };

export async function deleteVindiSubscription(
  client: VindiClient,
  vindiSubscriptionId: string,
): Promise<void> {
  try {
    await client.request({
      method: "DELETE",
      path: `/v1/subscriptions/${vindiSubscriptionId}`,
    });
  } catch (error) {
    if (error instanceof VindiApiError && error.status === 404) return;
    throw error;
  }
}

export async function cancelVindiSubscription(input: {
  client: VindiClient;
  store: VindiBackofficeCancelStore;
  userId: string;
  adminEmail: string;
  now: Date;
}): Promise<VindiBackofficeCancelResult> {
  const snapshot = await input.store.getSnapshot(input.userId);
  if (!snapshot) {
    return { ok: false, error: "user_not_found" };
  }

  const subscription = snapshot.subscription;
  if (!subscription || !canCancelVindiSubscription(subscription)) {
    if (subscription?.provider === "vindi" && subscription.cancelAtPeriodEnd) {
      return { ok: false, error: "already_scheduled" };
    }
    return { ok: false, error: "no_vindi_subscription" };
  }

  const dueAt = snapshot.expirationDate ?? subscription.currentPeriodEnd;
  const isTrial = subscription.status === "trialing";

  if (isTrial) {
    if (subscription.vindiSubscriptionId) {
      await deleteVindiSubscription(
        input.client,
        subscription.vindiSubscriptionId,
      );
    }
    await supersedeOpenLinks(input.client, input.store, snapshot, input.now);
    await input.store.applyTrialCancel({
      userId: input.userId,
      subscriptionId: subscription.id,
      now: input.now,
    });
    await input.store.cancelPendingPlanChanges(input.userId, input.now);
    const effects = vindiCardTrialCancelEffects({ now: input.now });
    await writeCancelRecords({
      store: input.store,
      snapshot,
      adminEmail: input.adminEmail,
      mode: "immediate",
      inSchedulingWindow: false,
      accessUntil: effects.expirationDate,
    });
    return {
      ok: true,
      mode: "immediate",
      inSchedulingWindow: false,
      accessUntil: effects.expirationDate,
    };
  }

  const decision = decideVindiCancel({
    paymentMethod: subscription.vindiPaymentMethod,
    dueAt,
    now: input.now,
  });

  if (decision.gateway === "delete" && subscription.vindiSubscriptionId) {
    await deleteVindiSubscription(
      input.client,
      subscription.vindiSubscriptionId,
    );
  }

  await supersedeOpenLinks(input.client, input.store, snapshot, input.now);

  const expirationDate = dueAt ?? input.now;
  const effects = vindiPaidCancelEffects({
    action: decision.action,
    now: input.now,
    expirationDate,
  });
  await input.store.applyPaidCancel({
    subscriptionId: subscription.id,
    effects,
    now: input.now,
  });
  await input.store.cancelPendingPlanChanges(input.userId, input.now);
  await writeCancelRecords({
    store: input.store,
    snapshot,
    adminEmail: input.adminEmail,
    mode: decision.mode,
    inSchedulingWindow: decision.action === "register_intent",
    accessUntil: effects.expirationDate,
  });

  return {
    ok: true,
    mode: decision.mode,
    inSchedulingWindow: decision.action === "register_intent",
    accessUntil: effects.expirationDate,
  };
}

async function supersedeOpenLinks(
  client: VindiClient,
  store: VindiBackofficeCancelStore,
  snapshot: VindiBackofficeCancelSnapshot,
  now: Date,
): Promise<void> {
  const pending = snapshot.openLinks.filter((link) => link.status === "pending");
  for (const link of pending) {
    if (link.vindiBillId) {
      await deleteVindiBill(client, link.vindiBillId);
    }
  }
  await store.markLinksSuperseded(
    pending.map((link) => link.id),
    now,
  );
}

async function writeCancelRecords(input: {
  store: VindiBackofficeCancelStore;
  snapshot: VindiBackofficeCancelSnapshot;
  adminEmail: string;
  mode: VindiCancelMode;
  inSchedulingWindow: boolean;
  accessUntil: Date;
}): Promise<void> {
  const subscription = input.snapshot.subscription;
  if (!subscription) return;

  await input.store.writeEvent({
    userId: input.snapshot.userId,
    subscriptionId: subscription.id,
    eventType: "canceled",
    fromPlan: subscription.planType,
    metadata: {
      source: "backoffice",
      mode: input.mode,
      immediate: input.mode !== "cancel_requested",
      canceledDuringTrial: subscription.status === "trialing",
      accessUntil: input.accessUntil.toISOString(),
      provider: "vindi",
      paymentMethod: subscription.vindiPaymentMethod,
      consentRemains: subscription.vindiPaymentMethod === "pix_automatic",
      inSchedulingWindow: input.inSchedulingWindow,
    },
  });

  const note = input.inSchedulingWindow
    ? "Intenção de cancelamento registrada na Janela de Agendamento. A cobrança agendada vale; o DELETE efetiva após o vencimento."
    : input.mode === "internal_only"
      ? "Assinatura Pix QR cancelada internamente."
      : "Assinatura Vindi cancelada com DELETE imediato.";

  await input.store.writeAudit({
    adminEmail: input.adminEmail,
    targetUserId: input.snapshot.userId,
    action: VINDI_CANCEL_AUDIT_ACTION,
    fieldName: "subscription.status",
    oldValue: subscription.status,
    newValue: input.mode === "cancel_requested" ? "cancel_requested" : "canceled",
    note,
  });
}
