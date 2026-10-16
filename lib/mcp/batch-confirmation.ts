import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Código de confirmação de lote (mudanças na Meta pelo MCP): amarra a
 * aprovação ao conteúdo exato da prévia, com validade. Mesmo desenho do
 * `send-confirmation.ts` das campanhas de WhatsApp.
 */
export const BATCH_CONFIRMATION_TTL_MS = 15 * 60 * 1000;

function sign(payload: unknown, expiresAt: number, secret: string) {
  return createHmac("sha256", secret).update(JSON.stringify([payload, expiresAt])).digest("base64url").slice(0, 22);
}

export function batchConfirmationCode(payload: unknown, secret: string, now = Date.now()): string {
  const expiresAt = now + BATCH_CONFIRMATION_TTL_MS;
  return `${expiresAt.toString(36)}.${sign(payload, expiresAt, secret)}`;
}

export function verifyBatchConfirmation(code: string, payload: unknown, secret: string, now = Date.now()): "ok" | "expired" | "mismatch" {
  const [encoded, given] = code.split(".");
  const expiresAt = Number.parseInt(encoded ?? "", 36);
  if (!given || !Number.isFinite(expiresAt)) return "mismatch";
  const expected = Buffer.from(sign(payload, expiresAt, secret));
  const received = Buffer.from(given);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return "mismatch";
  return expiresAt <= now ? "expired" : "ok";
}
