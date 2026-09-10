import "server-only";

import { createDecipheriv, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mercadoPagoExpertAccount } from "@/lib/db/schema";

function environment(): "sandbox" | "production" {
  return process.env.MERCADOPAGO_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
}

function decryptSecret(value: string, key: string): string {
  const [iv, tag, ciphertext] = value.split(".");
  if (!iv || !tag || !ciphertext) throw new Error("invalid_encrypted_secret");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256").update(key, "utf8").digest(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Selects the credential frozen for an old payment, never the active account. */
export async function getExpertMercadoPagoHistoricalAccount(
  expertId: string,
  mpUserId: string,
) {
  const encryptionKey = process.env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY?.trim();
  if (!encryptionKey) throw new Error("mercadopago_not_configured");
  const [account] = await db
    .select()
    .from(mercadoPagoExpertAccount)
    .where(
      and(
        eq(mercadoPagoExpertAccount.expertId, expertId),
        eq(mercadoPagoExpertAccount.mpUserId, mpUserId),
        eq(mercadoPagoExpertAccount.environment, environment()),
      ),
    )
    .limit(1);
  if (!account) throw new Error("historical_expert_account_not_found");
  return {
    mpUserId: account.mpUserId,
    accessToken: decryptSecret(account.accessTokenEncrypted, encryptionKey),
  };
}
