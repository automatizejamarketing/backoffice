import "server-only";

import { appSecretProof, facebookAppSecret } from "./appsecret-proof";
import { graphApiVersion, graphFacebookBaseUrl } from "./constant";

/**
 * Backoffice test tool, authorized by Vini on 2026-10-05 for the certification
 * work: with the CLIENT's own token, can our backend (a) add a partner Business
 * Manager to the client's ad account (`/act_X/agencies`) and (b) invite a
 * person to the client's Business Manager (`/{bm}/business_users`), with no
 * click from the client? Every grant has its undo.
 */

const GRAPH = `${graphFacebookBaseUrl}/${graphApiVersion}`;
export const PARTNER_TASKS = ["MANAGE", "ADVERTISE", "ANALYZE"];

export type GrantCall = {
  ok: boolean;
  httpStatus: number;
  code?: number;
  subcode?: number;
  message?: string;
  data?: unknown;
};

async function call(
  method: "GET" | "POST" | "DELETE",
  path: string,
  token: string,
  params: Record<string, string>,
): Promise<GrantCall> {
  const secret = facebookAppSecret();
  const query = new URLSearchParams({
    ...params,
    access_token: token,
    ...(secret ? { appsecret_proof: appSecretProof(token, secret) } : {}),
  });
  const res =
    method === "POST"
      ? await fetch(`${GRAPH}/${path}`, { method, body: query })
      : await fetch(`${GRAPH}/${path}?${query}`, { method, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as {
    error?: {
      code?: number;
      error_subcode?: number;
      message?: string;
      error_user_msg?: string;
    };
  } & Record<string, unknown>;
  if (json.error) {
    return {
      ok: false,
      httpStatus: res.status,
      code: json.error.code,
      subcode: json.error.error_subcode,
      message: (json.error.error_user_msg || json.error.message || "").slice(0, 400),
    };
  }
  return { ok: res.ok, httpStatus: res.status, data: json };
}

const act = (id: string) => (id.startsWith("act_") ? id : `act_${id}`);

export const listPartners = (token: string, adAccountId: string) =>
  call("GET", `${act(adAccountId)}/agencies`, token, { fields: "id,name", limit: "50" });

export const addPartner = (token: string, adAccountId: string, businessId: string) =>
  call("POST", `${act(adAccountId)}/agencies`, token, {
    business: businessId,
    permitted_tasks: JSON.stringify(PARTNER_TASKS),
  });

export const removePartner = (token: string, adAccountId: string, businessId: string) =>
  call("DELETE", `${act(adAccountId)}/agencies`, token, { business: businessId });

export const listPendingPeople = (token: string, clientBusinessId: string) =>
  call("GET", `${clientBusinessId}/pending_users`, token, {
    fields: "id,email,role,status",
    limit: "50",
  });

export const invitePerson = (token: string, clientBusinessId: string, email: string) =>
  call("POST", `${clientBusinessId}/business_users`, token, { email, role: "ADMIN" });

/** Cancels a still-pending invitation (id from `pending_users`). */
export const cancelInvite = (token: string, pendingUserId: string) =>
  call("DELETE", pendingUserId, token, {});

type ConnectionTargets = {
  tokenKind: string;
  clientBusinessId: string | null;
  assignedAssets?: { adAccounts?: Array<{ id: string; accountId?: string }> } | null;
};

/**
 * Ad account and client BM for a connection. A BISU connection stores both;
 * a personal ("user") connection stores neither, so they are read from Meta
 * (`/me/adaccounts`), preferring an account owned by a Business Manager.
 */
export async function resolveConnectionTargets(
  token: string,
  connection: ConnectionTargets,
): Promise<{ adAccountId: string | null; clientBusinessId: string | null }> {
  const stored = connection.assignedAssets?.adAccounts?.[0];
  const storedAccount = stored?.accountId ?? stored?.id ?? null;
  if (storedAccount && connection.clientBusinessId) {
    return { adAccountId: storedAccount, clientBusinessId: connection.clientBusinessId };
  }

  const res = await call("GET", "me/adaccounts", token, {
    fields: "account_id,business{id}",
    limit: "50",
  });
  const accounts =
    ((res.data as { data?: Array<{ account_id?: string; id?: string; business?: { id?: string } }> } | undefined)
      ?.data ?? []);
  const owned = accounts.find((a) => a.business?.id) ?? accounts[0];
  return {
    adAccountId: storedAccount ?? owned?.account_id ?? owned?.id ?? null,
    clientBusinessId: connection.clientBusinessId ?? owned?.business?.id ?? null,
  };
}
