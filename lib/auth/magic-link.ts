import { createHash, randomBytes } from "node:crypto";

export const BACKOFFICE_MAGIC_LINK_TTL_MINUTES = 30;

export function normalizeBackofficeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createBackofficeMagicLinkToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashBackofficeMagicLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getBackofficeMagicLinkExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + BACKOFFICE_MAGIC_LINK_TTL_MINUTES * 60 * 1000);
}
