import "server-only";

import type { ClickupCustomField, ClickupTask } from "./core";

/**
 * Cliente HTTP da API v2 do ClickUp (developer.clickup.com). O token OAuth não expira e não tem
 * escopos; revogado, a API responde com códigos `OAUTH_0xx`, que viram `ClickupAuthError`.
 */

const API = "https://api.clickup.com/api/v2";
const TIMEOUT_MS = 15_000;

export class ClickupAuthError extends Error {}
export class ClickupRateLimitError extends Error {
  constructor(readonly resetAt: Date | null) {
    super("Limite de chamadas do ClickUp atingido.");
  }
}
export class ClickupApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

/** Token revogado ou workspace não autorizado: só reconectar resolve. */
const AUTH_CODES = /^OAUTH_0(1[0-9]|2[0-9]|3[0-9]|4[0-5]|77)$/;

async function call<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (response.status === 429) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    throw new ClickupRateLimitError(Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : null);
  }
  const data = (await response.json().catch(() => ({}))) as { err?: string; ECODE?: string } & T;
  if (!response.ok) {
    const code = typeof data.ECODE === "string" ? data.ECODE : null;
    if (response.status === 401 || (code && AUTH_CODES.test(code))) throw new ClickupAuthError(data.err ?? "Acesso ao ClickUp revogado.");
    throw new ClickupApiError(data.err ?? `ClickUp respondeu ${response.status}.`, response.status, code);
  }
  return data;
}

export function authorizeUrl(clientId: string, redirectUri: string, state: string) {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state });
  return `https://app.clickup.com/api?${params}`;
}

export async function exchangeCode(clientId: string, clientSecret: string, code: string): Promise<string> {
  const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code });
  const response = await fetch(`${API}/oauth/token?${params}`, { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as { access_token?: string; err?: string };
  if (!response.ok || !data.access_token) throw new ClickupApiError(data.err ?? "O ClickUp não liberou o acesso.", response.status, null);
  return data.access_token;
}

export type ClickupUser = { id: number; username: string | null; email: string | null };
export const getAuthorizedUser = (token: string) => call<{ user: ClickupUser }>(token, "/user").then((r) => r.user);

export type Named = { id: string; name: string };
export const getTeams = (token: string) => call<{ teams: Named[] }>(token, "/team").then((r) => r.teams);
export const getSpaces = (token: string, teamId: string) =>
  call<{ spaces: Named[] }>(token, `/team/${teamId}/space?archived=false`).then((r) => r.spaces);
export const getFolders = (token: string, spaceId: string) =>
  call<{ folders: Array<Named & { lists?: Named[] }> }>(token, `/space/${spaceId}/folder?archived=false`).then((r) => r.folders);
export const getFolderlessLists = (token: string, spaceId: string) =>
  call<{ lists: Named[] }>(token, `/space/${spaceId}/list?archived=false`).then((r) => r.lists);

export type ClickupStatus = { status: string; type?: string; orderindex?: number };
export const getList = (token: string, listId: string) =>
  call<Named & { statuses?: ClickupStatus[] }>(token, `/list/${listId}`);
export const getListFields = (token: string, listId: string) =>
  call<{ fields: ClickupCustomField[] }>(token, `/list/${listId}/field`).then((r) => r.fields);
/** Tipos de tarefa personalizados do workspace (Post, Reels, Criativo…). */
export const getCustomTaskTypes = (token: string, teamId: string) =>
  call<{ custom_items: Array<{ id: number; name: string }> }>(token, `/team/${teamId}/custom_item`).then((r) => r.custom_items ?? []);

export const getTask = (token: string, taskId: string) => call<ClickupTask>(token, `/task/${encodeURIComponent(taskId)}`);

/** Tarefas da lista num status (para reconciliar eventos perdidos); até 3 páginas de 100. */
export async function getListTaskIdsInStatus(token: string, listId: string, status: string): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 0; page < 3; page++) {
    const params = new URLSearchParams({ page: String(page), subtasks: "true" });
    params.append("statuses[]", status);
    const data = await call<{ tasks: Array<{ id: string }>; last_page?: boolean }>(token, `/list/${listId}/task?${params}`);
    ids.push(...data.tasks.map((t) => t.id));
    if (data.last_page !== false || data.tasks.length < 100) break;
  }
  return ids;
}

export async function createListWebhook(token: string, teamId: string, listId: string, endpoint: string) {
  const data = await call<{ id: string; webhook: { id: string; secret: string } }>(token, `/team/${teamId}/webhook`, {
    method: "POST",
    body: { endpoint, events: ["taskStatusUpdated"], list_id: Number(listId) || listId },
  });
  return { id: data.webhook?.id ?? data.id, secret: data.webhook.secret };
}

export async function deleteWebhook(token: string, webhookId: string) {
  await call(token, `/webhook/${webhookId}`, { method: "DELETE" }).catch((error) => {
    if (error instanceof ClickupApiError && error.status === 404) return;
    throw error;
  });
}

export type WebhookHealth = { id: string; endpoint: string; health?: { status?: string; fail_count?: number } };
export const getWebhooks = (token: string, teamId: string) =>
  call<{ webhooks: WebhookHealth[] }>(token, `/team/${teamId}/webhook`).then((r) => r.webhooks ?? []);
export const reactivateWebhook = (token: string, webhookId: string, endpoint: string) =>
  call(token, `/webhook/${webhookId}`, { method: "PUT", body: { endpoint, events: ["taskStatusUpdated"], status: "active" } });

export const setTaskStatus = (token: string, taskId: string, status: string) =>
  call(token, `/task/${encodeURIComponent(taskId)}`, { method: "PUT", body: { status } });

/** Comentário com menção: só o formato `comment[]` marca a pessoa (o `comment_text` é texto puro). */
export function postComment(token: string, taskId: string, text: string, mentionUserId?: string | null) {
  const comment = mentionUserId
    ? [{ type: "tag", user: { id: Number(mentionUserId) } }, { text: ` ${text}` }]
    : [{ text }];
  return call(token, `/task/${encodeURIComponent(taskId)}/comment`, { method: "POST", body: { comment, notify_all: false } });
}
