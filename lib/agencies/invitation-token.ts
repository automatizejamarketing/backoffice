import { createHash, randomBytes } from "node:crypto";

/**
 * Mesmo cálculo de `lib/agency/invitations-core.ts` do frontend: o backoffice
 * gera o convite do Dono e o frontend o aceita. Token de 32 bytes em
 * base64url (43 caracteres); o banco guarda só o SHA-256 em hex.
 */
export const AGENCY_INVITATION_TTL_DAYS = 7;

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

export function invitationExpiresAt(now: Date): Date {
  return new Date(now.getTime() + AGENCY_INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function normalizeInvitationEmail(email: string): string | null {
  const normalized = email.trim().normalize("NFKC").toLowerCase();
  if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}
