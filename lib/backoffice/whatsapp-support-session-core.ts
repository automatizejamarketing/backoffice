import { createHash, randomInt } from "node:crypto";

export type WhatsappSupportEnvironment = "staging" | "prod";

export const WHATSAPP_SUPPORT_ACTIVATION_TTL_MS = 10 * 60 * 1000;
export const WHATSAPP_SUPPORT_DURATION_MINUTES = [15, 30, 60] as const;

export function resolveWhatsappSupportEnvironment(
  env: {
    APP_ENV?: string;
    VERCEL?: string;
    VERCEL_ENV?: string;
    VERCEL_GIT_COMMIT_REF?: string;
  } = {
    APP_ENV: process.env.APP_ENV,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
  },
): WhatsappSupportEnvironment | null {
  if (env.VERCEL !== "1") {
    return null;
  }

  const appEnv = env.APP_ENV?.trim().toLowerCase();
  if (appEnv === "prod" || appEnv === "production") {
    return "prod";
  }
  if (
    appEnv === "staging" ||
    env.VERCEL_GIT_COMMIT_REF?.trim().toLowerCase() === "staging"
  ) {
    return "staging";
  }
  if (env.VERCEL_ENV?.trim().toLowerCase() === "production") {
    return "prod";
  }
  return null;
}

export function normalizeSupportPhoneE164(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  const national =
    digits.length > 11 && digits.startsWith("55") ? digits.slice(2) : digits;
  if (national.length !== 10 && national.length !== 11) {
    return null;
  }
  return `+55${national}`;
}

export function isWhatsappSupportDuration(
  value: number,
): value is (typeof WHATSAPP_SUPPORT_DURATION_MINUTES)[number] {
  return WHATSAPP_SUPPORT_DURATION_MINUTES.includes(
    value as (typeof WHATSAPP_SUPPORT_DURATION_MINUTES)[number],
  );
}

export function normalizeWhatsappSupportReason(value: string): string | null {
  const reason = value.trim();
  return reason.length >= 10 && reason.length <= 500 ? reason : null;
}

export function generateWhatsappSupportActivationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashWhatsappSupportActivationCode(
  sessionId: string,
  code: string,
): string {
  return createHash("sha256").update(`${sessionId}:${code}`).digest("hex");
}
