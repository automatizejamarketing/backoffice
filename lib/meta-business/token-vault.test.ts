import { afterEach, describe, expect, test } from "bun:test";
import {
  decryptAccessToken,
  encryptAccessToken,
  isEncryptedTokenEnvelope,
} from "./token-vault";

describe("Meta token vault", () => {
  const original = process.env.META_TOKEN_ENCRYPTION_KEYS;
  const originalPlaintext = process.env.META_TOKEN_ALLOW_PLAINTEXT;
  const originalAppEnv = process.env.APP_ENV;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.META_TOKEN_ENCRYPTION_KEYS;
    } else {
      process.env.META_TOKEN_ENCRYPTION_KEYS = original;
    }
    if (originalPlaintext === undefined) {
      delete process.env.META_TOKEN_ALLOW_PLAINTEXT;
    } else {
      process.env.META_TOKEN_ALLOW_PLAINTEXT = originalPlaintext;
    }
    if (originalAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = originalAppEnv;
    }
  });

  test("passes through legacy plaintext tokens", () => {
    delete process.env.META_TOKEN_ENCRYPTION_KEYS;
    const token = "EAAG_legacy";
    expect(decryptAccessToken(token)).toBe(token);
    expect(isEncryptedTokenEnvelope(token)).toBe(false);
  });

  test("round-trips encrypted tokens", () => {
    process.env.META_TOKEN_ENCRYPTION_KEYS = `v1:${Buffer.alloc(32, 7).toString("base64")}`;
    const token = "EAAG_secret";
    const encrypted = encryptAccessToken(token);
    expect(isEncryptedTokenEnvelope(encrypted)).toBe(true);
    expect(encrypted.startsWith("enc:v1:")).toBe(true);
    expect(decryptAccessToken(encrypted)).toBe(token);
  });

  test("decrypts with a rotated key when the version is still present", () => {
    const key1 = Buffer.alloc(32, 1).toString("base64");
    const key2 = Buffer.alloc(32, 2).toString("base64");
    process.env.META_TOKEN_ENCRYPTION_KEYS = `v1:${key1}`;
    const encrypted = encryptAccessToken("tok");
    process.env.META_TOKEN_ENCRYPTION_KEYS = `v2:${key2},v1:${key1}`;
    expect(decryptAccessToken(encrypted)).toBe("tok");
  });
});
