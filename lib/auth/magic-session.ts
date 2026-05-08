import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BACKOFFICE_MAGIC_SESSION_COOKIE,
  BACKOFFICE_MAGIC_SESSION_MAX_AGE_SECONDS,
} from "./magic-session-constants";

export {
  BACKOFFICE_MAGIC_SESSION_COOKIE,
  BACKOFFICE_MAGIC_SESSION_MAX_AGE_SECONDS,
} from "./magic-session-constants";

type BackofficeMagicSessionPayload = {
  email: string;
  iat: number;
  exp: number;
};

type SessionTokenOptions = {
  now?: Date;
  secret?: string | null;
};

export type BackofficeMagicSession = {
  email: string;
  issuedAt: Date;
  expiresAt: Date;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function resolveSessionSecret(secret?: string | null): string {
  const resolved =
    secret ??
    process.env.BACKOFFICE_SESSION_SECRET ??
    process.env.JWT_SECRET ??
    process.env.AUTH_SECRET;

  if (!resolved?.trim()) {
    throw new Error("Missing backoffice session secret");
  }

  return resolved;
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function isValidSignature(
  encodedPayload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = signPayload(encodedPayload, secret);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  return (
    expectedBuffer.length === signatureBuffer.length &&
    timingSafeEqual(expectedBuffer, signatureBuffer)
  );
}

export function createBackofficeMagicSessionToken(
  email: string,
  options: SessionTokenOptions = {},
): string {
  const now = options.now ?? new Date();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload: BackofficeMagicSessionPayload = {
    email: normalizeEmail(email),
    iat: issuedAt,
    exp: issuedAt + BACKOFFICE_MAGIC_SESSION_MAX_AGE_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = signPayload(
    encodedPayload,
    resolveSessionSecret(options.secret),
  );

  return `${encodedPayload}.${signature}`;
}

export function verifyBackofficeMagicSessionToken(
  token: string | null | undefined,
  options: SessionTokenOptions = {},
): BackofficeMagicSession | null {
  try {
    if (!token) return null;

    const [encodedPayload, signature, extra] = token.split(".");
    if (!encodedPayload || !signature || extra) return null;

    const secret = resolveSessionSecret(options.secret);
    if (!isValidSignature(encodedPayload, signature, secret)) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<BackofficeMagicSessionPayload>;
    const nowInSeconds = Math.floor(
      (options.now ?? new Date()).getTime() / 1000,
    );

    if (
      typeof payload.email !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp <= nowInSeconds
    ) {
      return null;
    }

    return {
      email: normalizeEmail(payload.email),
      issuedAt: new Date(payload.iat * 1000),
      expiresAt: new Date(payload.exp * 1000),
    };
  } catch {
    return null;
  }
}
