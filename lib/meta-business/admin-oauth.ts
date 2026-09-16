import "server-only";

import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { metaAdminOauthAttempt } from "@/lib/db/schema";
import { graphApiVersion } from "@/lib/meta-business/constant";
import { hashOauthState } from "@/lib/meta-business/oauth-state-utils";
import {
  defaultAdminReconnectMode,
  type MetaAuthMode,
} from "@/lib/meta-business/admin-oauth-utils";

export {
  defaultAdminReconnectMode,
  type MetaAuthMode,
} from "@/lib/meta-business/admin-oauth-utils";

const STATE_TTL_MS = 10 * 60 * 1000;

function firstEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function generateMarketingAuthUrl(args: {
  state: string;
  mode?: MetaAuthMode;
  forceReauth?: boolean;
}): string {
  const appId = firstEnv("META_GENERAL_APP_ID", "NEXT_PUBLIC_META_GENERAL_APP_ID");
  const redirectUri = firstEnv(
    "META_MARKETING_REDIRECT_URI",
    "NEXT_PUBLIC_META_MARKETING_REDIRECT_URI",
  );
  const mode = args.mode ?? defaultAdminReconnectMode();
  const configId =
    mode === "user"
      ? firstEnv("META_MARKETING_USER_CONFIG_ID")
      : firstEnv(
          "META_MARKETING_BISU_CONFIG_ID",
          "NEXT_PUBLIC_META_MARKETING_CONFIG_ID",
        );

  if (!appId || !redirectUri || !configId) {
    throw new Error("Meta Marketing OAuth is not configured for admin reconnect.");
  }

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    config_id: configId,
    response_type: "code",
    state: args.state,
    ...(args.forceReauth ? { auth_type: "rerequest" } : {}),
  });

  return `https://www.facebook.com/${graphApiVersion}/dialog/oauth?${params.toString()}`;
}

export async function createAdminOauthAttempt(args: {
  targetUserId: string;
  actorAdminId: string;
  actorAdminEmail: string;
  authMode?: MetaAuthMode;
}): Promise<{ state: string; attemptId: string; authMode: MetaAuthMode; authUrl: string }> {
  const state = randomBytes(32).toString("base64url");
  const authMode = args.authMode ?? defaultAdminReconnectMode();
  const [row] = await db
    .insert(metaAdminOauthAttempt)
    .values({
      targetUserId: args.targetUserId,
      actorAdminId: args.actorAdminId,
      actorAdminEmail: args.actorAdminEmail,
      stateHash: hashOauthState(state),
      authMode,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    })
    .returning({ id: metaAdminOauthAttempt.id });

  return {
    state,
    attemptId: row.id,
    authMode,
    authUrl: generateMarketingAuthUrl({
      state,
      mode: authMode,
      forceReauth: true,
    }),
  };
}
