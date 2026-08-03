import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Versioned AES-256-GCM envelope for Meta access tokens at rest.
 *
 * Envelope format: `enc:v{N}:{ivBase64}:{tagBase64}:{ciphertextBase64}`
 * Legacy plaintext tokens (no `enc:` prefix) are returned as-is for dual-read.
 *
 * Keyring env: META_TOKEN_ENCRYPTION_KEYS=v1:<base64-32-byte>,v2:<...>
 * The first entry is used for encryption; all entries are tried for decryption.
 *
 * Keep in sync with automatize-frontend/lib/meta-business/marketing/token-vault.ts
 */

const ENVELOPE_PREFIX = "enc:";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

type KeyEntry = {
  version: string;
  key: Buffer;
};

function parseKeyring(): KeyEntry[] {
  const raw = process.env.META_TOKEN_ENCRYPTION_KEYS?.trim();
  if (!raw) return [];

  const entries: KeyEntry[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) {
      throw new Error(
        `Invalid META_TOKEN_ENCRYPTION_KEYS entry "${trimmed}". Expected vN:base64key`,
      );
    }
    const version = trimmed.slice(0, colon);
    const keyB64 = trimmed.slice(colon + 1);
    const key = Buffer.from(keyB64, "base64");
    if (key.length !== 32) {
      throw new Error(
        `META_TOKEN_ENCRYPTION_KEYS ${version} must decode to 32 bytes (got ${key.length})`,
      );
    }
    entries.push({ version, key });
  }
  return entries;
}

export function isEncryptedTokenEnvelope(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX);
}

/**
 * Encrypt a plaintext Meta access token.
 * Plaintext writes are allowed only when explicitly opted into from local/test.
 */
export function encryptAccessToken(plaintext: string): string {
  const keyring = parseKeyring();
  if (keyring.length === 0) {
    const isLocalOrTest =
      process.env.APP_ENV === "local" ||
      (!process.env.APP_ENV && process.env.NODE_ENV === "test");
    if (isLocalOrTest && process.env.META_TOKEN_ALLOW_PLAINTEXT === "true") {
      return plaintext;
    }
    throw new Error(
      "META_TOKEN_ENCRYPTION_KEYS is required to persist Meta access tokens",
    );
  }

  const active = keyring[0];
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, active.key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    ENVELOPE_PREFIX + active.version,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypt an envelope or pass through legacy plaintext.
 */
export function decryptAccessToken(stored: string): string {
  if (!isEncryptedTokenEnvelope(stored)) {
    return stored;
  }

  const keyring = parseKeyring();
  if (keyring.length === 0) {
    throw new Error(
      "Encrypted Meta token found but META_TOKEN_ENCRYPTION_KEYS is not configured",
    );
  }

  // enc:v1:iv:tag:ciphertext  → parts after stripping "enc:"
  const withoutPrefix = stored.slice(ENVELOPE_PREFIX.length);
  const parts = withoutPrefix.split(":");
  if (parts.length !== 4) {
    throw new Error("Malformed Meta token encryption envelope");
  }

  const [version, ivB64, tagB64, ciphertextB64] = parts;
  const entry = keyring.find((k) => k.version === version);
  if (!entry) {
    throw new Error(
      `No decryption key for Meta token envelope version ${version}`,
    );
  }

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, entry.key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
