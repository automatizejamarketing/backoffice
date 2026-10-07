import "server-only";

import { desc, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { metaCertificationState, metaConsultantCredential } from "@/lib/db/schema";
import { appSecretProof, facebookAppSecret } from "./appsecret-proof";
import { graphApiVersion, graphFacebookBaseUrl } from "./constant";
import { decryptAccessToken } from "./token-vault";

/**
 * Backoffice "Testar certificação Meta": does Meta refuse `POST /ads` for this
 * ad account with 100/2859024 (non-discrimination certification)?
 *
 * Every call is a GET except one `POST /act_X/ads` per token with
 * `execution_options=["validate_only"]`, which Meta checks and never creates.
 * Tokens never leave the server; the result only carries masked ids.
 */

const GRAPH = `${graphFacebookBaseUrl}/${graphApiVersion}`;
const CERTIFICATION_SUBCODE = 2859024;

type GraphError = {
  code?: number;
  error_subcode?: number;
  message?: string;
  error_user_msg?: string;
};

export type DiagnosticCall = {
  ok: boolean;
  httpStatus: number;
  code?: number;
  subcode?: number;
  message?: string;
};

export type TokenDiagnostic = {
  label: string;
  /** Last 4 digits of the Facebook user / system user behind the token. */
  identity: string;
  account: DiagnosticCall & {
    accountStatus?: number;
    businessName?: string;
    businessId?: string;
  };
  adSet: DiagnosticCall & { effectiveStatus?: string };
  validateOnlyAd: DiagnosticCall & { skipped?: string };
  certificationRefused: boolean;
};

export type CertificationDiagnostic = {
  adAccountId: string;
  adSetId: string | null;
  creativeId: string | null;
  ranAt: string;
  tokens: TokenDiagnostic[];
};

const mask = (id: unknown) =>
  typeof id === "string" && id ? `…${id.slice(-4)}` : "(desconhecido)";

function withAuth(token: string, params: Record<string, string>) {
  const secret = facebookAppSecret();
  return new URLSearchParams({
    ...params,
    access_token: token,
    ...(secret ? { appsecret_proof: appSecretProof(token, secret) } : {}),
  });
}

async function graph(
  method: "GET" | "POST",
  path: string,
  token: string,
  params: Record<string, string>,
): Promise<{ status: number; json: Record<string, unknown> & { error?: GraphError } }> {
  const query = withAuth(token, params);
  const res =
    method === "GET"
      ? await fetch(`${GRAPH}/${path}?${query}`, { cache: "no-store" })
      : await fetch(`${GRAPH}/${path}`, { method: "POST", body: query });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: GraphError;
  };
  return { status: res.status, json };
}

function toCall(status: number, error?: GraphError): DiagnosticCall {
  if (!error) return { ok: status < 400, httpStatus: status };
  return {
    ok: false,
    httpStatus: status,
    code: error.code,
    subcode: error.error_subcode,
    message: (error.error_user_msg || error.message || "").slice(0, 300),
  };
}

async function diagnoseToken(args: {
  label: string;
  token: string;
  adAccountId: string;
  adSetId: string | null;
  creativeId: string | null;
}): Promise<TokenDiagnostic> {
  const { token, adAccountId, adSetId, creativeId } = args;

  const me = await graph("GET", "me", token, { fields: "id" });
  const account = await graph("GET", adAccountId, token, {
    fields: "account_status,business{id,name}",
  });
  const business = account.json.business as { id?: string; name?: string } | undefined;

  const adSet = adSetId
    ? await graph("GET", adSetId, token, { fields: "effective_status" })
    : null;

  let validateOnlyAd: TokenDiagnostic["validateOnlyAd"];
  if (!adSetId || !creativeId) {
    validateOnlyAd = {
      ok: false,
      httpStatus: 0,
      skipped: !adSetId
        ? "Nenhum conjunto de anúncios encontrado nesta conta."
        : "Nenhum criativo encontrado nesta conta.",
    };
  } else {
    const res = await graph("POST", `${adAccountId}/ads`, token, {
      name: "Automatize · teste de certificação (validate_only)",
      adset_id: adSetId,
      creative: JSON.stringify({ creative_id: creativeId }),
      status: "PAUSED",
      execution_options: JSON.stringify(["validate_only"]),
    });
    validateOnlyAd = toCall(res.status, res.json.error);
  }

  return {
    label: args.label,
    identity: mask(me.json.id),
    account: {
      ...toCall(account.status, account.json.error),
      accountStatus: account.json.account_status as number | undefined,
      businessId: business?.id,
      businessName: business?.name,
    },
    adSet: adSet
      ? {
          ...toCall(adSet.status, adSet.json.error),
          effectiveStatus: adSet.json.effective_status as string | undefined,
        }
      : { ok: false, httpStatus: 0, message: "Sem conjunto de anúncios." },
    validateOnlyAd,
    certificationRefused: validateOnlyAd.subcode === CERTIFICATION_SUBCODE,
  };
}

/** Most recent ad set and creative of the account, read with the client token. */
async function pickTargets(token: string, adAccountId: string) {
  const [adSets, creatives] = await Promise.all([
    graph("GET", `${adAccountId}/adsets`, token, { fields: "id", limit: "1" }),
    graph("GET", `${adAccountId}/adcreatives`, token, { fields: "id", limit: "1" }),
  ]);
  const first = (r: { json: Record<string, unknown> }) =>
    ((r.json.data as Array<{ id?: string }> | undefined)?.[0]?.id ?? null);
  return { adSetId: first(adSets), creativeId: first(creatives) };
}

async function consultantTokens(): Promise<Array<{ label: string; token: string }>> {
  const now = new Date();
  const rows = await db
    .select({
      name: metaConsultantCredential.name,
      email: metaConsultantCredential.actorAdminEmail,
      accessToken: metaConsultantCredential.accessToken,
    })
    .from(metaConsultantCredential)
    .where(
      or(
        isNull(metaConsultantCredential.tokenExpiresAt),
        gt(metaConsultantCredential.tokenExpiresAt, now),
      ),
    )
    .orderBy(desc(metaConsultantCredential.updatedAt))
    .limit(8);
  return rows.flatMap((row) => {
    try {
      return [
        {
          label: `Consultor ${row.name ?? row.email}`,
          token: decryptAccessToken(row.accessToken),
        },
      ];
    } catch {
      return [];
    }
  });
}

/**
 * The client's personal token saved by the certification flow (frontend
 * `certification/state.ts`), with what the post-connect check found for the
 * BISU and for that token.
 */
async function clientPersonalToken(
  userId: string,
): Promise<Array<{ label: string; token: string }>> {
  const [row] = await db
    .select({
      token: metaCertificationState.personalAccessToken,
      expiresAt: metaCertificationState.personalTokenExpiresAt,
    })
    .from(metaCertificationState)
    .where(eq(metaCertificationState.userId, userId))
    .limit(1);
  if (!row?.token) return [];
  const expired = row.expiresAt ? row.expiresAt <= new Date() : false;
  try {
    return [
      {
        label: `Facebook pessoal do cliente${expired ? " (expirado)" : ""}`,
        token: decryptAccessToken(row.token),
      },
    ];
  } catch {
    return [];
  }
}

export async function runCertificationDiagnostic(args: {
  userId: string;
  clientToken: string;
  adAccountId: string;
  adSetId?: string | null;
}): Promise<CertificationDiagnostic> {
  const adAccountId = args.adAccountId.startsWith("act_")
    ? args.adAccountId
    : `act_${args.adAccountId}`;
  const picked = await pickTargets(args.clientToken, adAccountId);
  const adSetId = args.adSetId ?? picked.adSetId;
  const creativeId = picked.creativeId;

  const tokens = [
    { label: "Token do cliente", token: args.clientToken },
    ...(await clientPersonalToken(args.userId)),
    ...(await consultantTokens()),
  ];
  const results: TokenDiagnostic[] = [];
  for (const entry of tokens) {
    results.push(
      await diagnoseToken({ ...entry, adAccountId, adSetId, creativeId }),
    );
  }

  return {
    adAccountId,
    adSetId,
    creativeId,
    ranAt: new Date().toISOString(),
    tokens: results,
  };
}
