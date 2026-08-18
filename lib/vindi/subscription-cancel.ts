import { addDays } from "date-fns";
import type {
  SubscriptionStatus,
  VindiSubscriptionPaymentMethod,
} from "@/lib/db/schema";

const SCHEDULING_WINDOW_DAYS = 2;

function saoPauloDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatSaoPauloLongDate(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export const VINDI_PIX_AUTOMATIC_CONSENT_REMAINS_COPY =
  "O consentimento do Pix Automático continua registrado no seu banco. A revogação é feita no aplicativo do banco.";

export const VINDI_CANCEL_IN_WINDOW_COPY =
  "A cobrança desta renovação já está agendada e será debitada. Seu acesso segue até o fim do novo período. O cancelamento será efetivado após o vencimento.";

export type VindiPixAutomaticSchedulingWindow = {
  inWindow: boolean;
  duePassed: boolean;
  cancelUntilDateKey: string;
  dueDateKey: string;
  cancelUntilAt: Date;
  dueAt: Date;
};

export function vindiPixAutomaticSchedulingWindow(input: {
  dueAt: Date;
  now?: Date;
}): VindiPixAutomaticSchedulingWindow {
  const now = input.now ?? new Date();
  const cancelUntilAt = addDays(input.dueAt, -SCHEDULING_WINDOW_DAYS);
  const todayKey = saoPauloDateKey(now);
  const cancelUntilDateKey = saoPauloDateKey(cancelUntilAt);
  const dueDateKey = saoPauloDateKey(input.dueAt);
  return {
    inWindow: todayKey > cancelUntilDateKey && todayKey <= dueDateKey,
    duePassed: todayKey > dueDateKey,
    cancelUntilDateKey,
    dueDateKey,
    cancelUntilAt,
    dueAt: input.dueAt,
  };
}

export type VindiPixAutomaticSchedulingWindowCopy = {
  cancelUntil: string;
  inWindow: string | null;
  reopensOn: string | null;
  consentRemains: string;
};

export function vindiPixAutomaticSchedulingWindowCopy(input: {
  dueAt: Date;
  now?: Date;
}): VindiPixAutomaticSchedulingWindowCopy {
  const window = vindiPixAutomaticSchedulingWindow(input);
  const until = formatSaoPauloLongDate(window.cancelUntilAt);
  const reopens = formatSaoPauloLongDate(addDays(window.dueAt, 1));
  return {
    cancelUntil: `Cancele até ${until} para não renovar.`,
    inWindow: window.inWindow ? VINDI_CANCEL_IN_WINDOW_COPY : null,
    reopensOn: window.inWindow
      ? `O cancelamento da renovação volta a ser possível em ${reopens}.`
      : null,
    consentRemains: VINDI_PIX_AUTOMATIC_CONSENT_REMAINS_COPY,
  };
}

export type VindiCancelAction = "delete_now" | "register_intent" | "internal_only";
export type VindiCancelGateway = "delete" | "none";
export type VindiCancelMode = "immediate" | "cancel_requested" | "internal_only";

export type VindiCancelDecision = {
  action: VindiCancelAction;
  gateway: VindiCancelGateway;
  mode: VindiCancelMode;
};

export function decideVindiCancel(input: {
  paymentMethod: VindiSubscriptionPaymentMethod | null | undefined;
  dueAt: Date | null;
  now?: Date;
}): VindiCancelDecision {
  if (input.paymentMethod === "pix_qr") {
    return {
      action: "internal_only",
      gateway: "none",
      mode: "internal_only",
    };
  }

  if (input.paymentMethod === "pix_automatic" && input.dueAt) {
    const window = vindiPixAutomaticSchedulingWindow({
      dueAt: input.dueAt,
      now: input.now,
    });
    if (window.inWindow) {
      return {
        action: "register_intent",
        gateway: "none",
        mode: "cancel_requested",
      };
    }
  }

  return {
    action: "delete_now",
    gateway: "delete",
    mode: "immediate",
  };
}

export type VindiPaidCancelEffects = {
  status: Extract<SubscriptionStatus, "active" | "canceled">;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date;
  endedAt: Date | null;
  expirationDate: Date;
};

export function vindiPaidCancelEffects(input: {
  action: VindiCancelAction;
  now: Date;
  expirationDate: Date;
}): VindiPaidCancelEffects {
  if (input.action === "register_intent") {
    return {
      status: "active",
      cancelAtPeriodEnd: true,
      canceledAt: input.now,
      endedAt: null,
      expirationDate: input.expirationDate,
    };
  }
  return {
    status: "canceled",
    cancelAtPeriodEnd: false,
    canceledAt: input.now,
    endedAt: input.now,
    expirationDate: input.expirationDate,
  };
}

export function vindiCardTrialCancelEffects(input: { now: Date }): {
  status: Extract<SubscriptionStatus, "canceled">;
  expirationDate: Date;
} {
  return {
    status: "canceled",
    expirationDate: input.now,
  };
}

export const VINDI_CANCELABLE_STATUSES = [
  "active",
  "trialing",
  "past_due",
] as const;

export function canCancelVindiSubscription(input: {
  provider?: string | null;
  status?: string | null;
  cancelAtPeriodEnd?: boolean | null;
}): boolean {
  if (input.provider !== "vindi") return false;
  if (input.cancelAtPeriodEnd) return false;
  return VINDI_CANCELABLE_STATUSES.includes(
    input.status as (typeof VINDI_CANCELABLE_STATUSES)[number],
  );
}
