import { createHmac, timingSafeEqual } from "node:crypto";

/** A preview stays confirmable for 15 minutes; after that the user must see a fresh one. */
export const SEND_CONFIRMATION_TTL_MS = 15 * 60 * 1000;

type SendConfirmationInput = { campaignId: string; revision: string; scheduledAt: string | null; userIds: string[] };

function signature(input: SendConfirmationInput, expiresAt: number, secret: string): string {
  const payload = JSON.stringify([input.campaignId, input.revision, input.scheduledAt ?? "now", [...input.userIds].sort(), expiresAt]);
  return createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 22);
}

/** Binds a send confirmation to the exact campaign revision, time and audience shown in the preview, with an expiry. */
export function sendConfirmationCode(input: SendConfirmationInput, secret: string, now = Date.now()): string {
  const expiresAt = now + SEND_CONFIRMATION_TTL_MS;
  return `${expiresAt.toString(36)}.${signature(input, expiresAt, secret)}`;
}

export function verifySendConfirmation(code: string, input: SendConfirmationInput, secret: string, now = Date.now()): "ok" | "expired" | "mismatch" {
  const [encodedExpiry, given] = code.split(".");
  const expiresAt = Number.parseInt(encodedExpiry ?? "", 36);
  if (!given || !Number.isFinite(expiresAt)) return "mismatch";
  const expected = Buffer.from(signature(input, expiresAt, secret));
  const received = Buffer.from(given);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return "mismatch";
  return expiresAt <= now ? "expired" : "ok";
}
