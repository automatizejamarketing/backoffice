import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { canManageAgency } from "@/lib/agency/agencies";
import type { BackofficeActor } from "@/lib/auth/rbac-core";
import { db } from "@/lib/db";
import { agencyClient, clickupConnection } from "@/lib/db/schema";
import { encryptAccessToken } from "@/lib/meta-business/token-vault";
import {
  createListWebhook,
  deleteWebhook,
  exchangeCode,
  getAuthorizedUser,
  getCustomTaskTypes,
  getFolderlessLists,
  getFolders,
  getList,
  getListFields,
  getSpaces,
  getTeams,
} from "./api";
import { getConnection, tokenOf } from "./service";

/** Conexão do Dono com o ClickUp: OAuth, opções para o mapeamento e registro do webhook. */

export class ClickupSetupError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 503 = 400,
  ) {
    super(message);
  }
}

export function clickupCredentials() {
  const clientId = process.env.CLICKUP_CLIENT_ID;
  const clientSecret = process.env.CLICKUP_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const callbackPath = "/api/clickup/oauth/callback";
export const webhookEndpoint = (origin: string, agencyId: string) => `${origin.replace(/\/$/, "")}/api/clickup/webhook/${agencyId}`;

function stateSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new ClickupSetupError("AUTH_SECRET ausente.", 503);
  return secret;
}

const sign = (payload: string) => createHmac("sha256", stateSecret()).update(`clickup-oauth:${payload}`).digest("base64url");

/** `state` do OAuth: agência + pessoa + validade de 15 min, assinado. Volta só para quem começou. */
export function oauthState(agencyId: string, actorId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ a: agencyId, u: actorId, e: now + 15 * 60_000, n: randomBytes(8).toString("hex") })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readOauthState(state: string, actorId: string, now = Date.now()): string {
  const [payload, signature] = state.split(".");
  const expected = payload ? Buffer.from(sign(payload)) : null;
  if (!payload || !signature || !expected || expected.length !== Buffer.byteLength(signature) || !timingSafeEqual(expected, Buffer.from(signature))) {
    throw new ClickupSetupError("Link de conexão inválido. Comece de novo pela tela da agência.", 403);
  }
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { a: string; u: string; e: number };
  if (data.e < now) throw new ClickupSetupError("O link de conexão venceu. Comece de novo.", 403);
  if (data.u !== actorId) throw new ClickupSetupError("A conexão foi iniciada por outra pessoa.", 403);
  return data.a;
}

function assertManage(actor: BackofficeActor, agencyId: string) {
  if (!canManageAgency(actor, agencyId)) throw new ClickupSetupError("Sem acesso a esta agência.", 403);
}

/** Troca o código pelo token e guarda (cifrado). Reconectar mantém o mapeamento. */
export async function completeOauth(actor: BackofficeActor, agencyId: string, code: string) {
  assertManage(actor, agencyId);
  const credentials = clickupCredentials();
  if (!credentials) throw new ClickupSetupError("O app do ClickUp ainda não foi configurado no Automatize.", 503);
  const token = await exchangeCode(credentials.clientId, credentials.clientSecret, code);
  const user = await getAuthorizedUser(token);
  const values = {
    accessTokenEncrypted: encryptAccessToken(token),
    clickupUserId: String(user.id),
    clickupUserEmail: user.email,
    status: "active",
    statusDetail: null,
    connectedByEmail: actor.email,
    updatedAt: new Date(),
  };
  await db
    .insert(clickupConnection)
    .values({ agencyId, ...values })
    .onConflictDoUpdate({ target: clickupConnection.agencyId, set: values });
}

async function requireConnection(actor: BackofficeActor, agencyId: string) {
  assertManage(actor, agencyId);
  const connection = await getConnection(agencyId);
  if (!connection) throw new ClickupSetupError("Conecte o ClickUp primeiro.", 409);
  return { connection, token: tokenOf(connection) };
}

/** Opções para o mapeamento: workspaces → listas (com o caminho) → campos, status e tipos. */
export async function mappingOptions(actor: BackofficeActor, agencyId: string, query: { teamId?: string; listId?: string }) {
  const { token } = await requireConnection(actor, agencyId);
  const teams = await getTeams(token);
  if (!query.teamId) return { teams };
  const spaces = await getSpaces(token, query.teamId);
  const lists = (
    await Promise.all(
      spaces.map(async (space) => {
        const [folders, loose] = await Promise.all([getFolders(token, space.id), getFolderlessLists(token, space.id)]);
        return [
          ...loose.map((l) => ({ id: l.id, name: l.name, path: space.name })),
          ...folders.flatMap((f) => (f.lists ?? []).map((l) => ({ id: l.id, name: l.name, path: `${space.name} / ${f.name}` }))),
        ];
      }),
    )
  ).flat();
  const taskTypes = await getCustomTaskTypes(token, query.teamId).catch(() => []);
  if (!query.listId) return { teams, lists, taskTypes };
  const [list, fields] = await Promise.all([getList(token, query.listId), getListFields(token, query.listId)]);
  return {
    teams,
    lists,
    taskTypes,
    statuses: (list.statuses ?? []).map((s) => s.status),
    fields: fields.map((f) => ({ id: f.id, name: f.name ?? f.id, type: f.type, options: f.type_config?.options?.map((o) => ({ id: o.id, name: o.name ?? o.id })) ?? [] })),
  };
}

const mappingSchema = z.object({
  teamId: z.string().min(1),
  teamName: z.string().min(1),
  listId: z.string().min(1),
  listName: z.string().min(1),
  clientFieldId: z.string().min(1),
  mediaFieldId: z.string().min(1).nullable(),
  captionFieldId: z.string().min(1),
  publishAtFieldId: z.string().min(1),
  formats: z.record(z.string(), z.enum(["post", "reels"])).refine((f) => Object.keys(f).length > 0, "Escolha ao menos um tipo de tarefa."),
  statuses: z.object({ approval: z.string().min(1), scheduled: z.string().min(1), published: z.string().min(1), error: z.string().min(1).nullable() }),
  clientOptions: z.record(z.string(), z.string().uuid()),
});

export type MappingInput = z.infer<typeof mappingSchema>;

/**
 * Salva o mapeamento e (re)registra o webhook da lista. Só aceita ligar opções a clientes desta
 * agência; status repetidos entre Aprovação/Agendado/Publicado seriam um laço, então são recusados.
 */
export async function saveMapping(actor: BackofficeActor, agencyId: string, raw: unknown, origin: string) {
  const { connection, token } = await requireConnection(actor, agencyId);
  const parsed = mappingSchema.safeParse(raw);
  if (!parsed.success) throw new ClickupSetupError(parsed.error.issues.map((i) => i.message).join(" · "));
  const input = parsed.data;
  const named = [input.statuses.approval, input.statuses.scheduled, input.statuses.published, input.statuses.error].filter(Boolean).map((s) => s!.toLowerCase());
  if (new Set(named).size !== named.length) throw new ClickupSetupError("Aprovação, Agendado, Publicado e Erro precisam ser status diferentes.");
  const clients = await db.select({ userId: agencyClient.userId }).from(agencyClient).where(eq(agencyClient.agencyId, agencyId));
  const allowed = new Set(clients.map((c) => c.userId));
  if (Object.values(input.clientOptions).some((userId) => !allowed.has(userId))) throw new ClickupSetupError("Só dá para ligar opções a clientes desta agência.", 403);

  const { teamId, teamName, ...mapping } = input;
  if (connection.webhookId) await deleteWebhook(token, connection.webhookId);
  const hook = await createListWebhook(token, teamId, input.listId, webhookEndpoint(origin, agencyId));
  await db
    .update(clickupConnection)
    .set({ teamId, teamName, mapping, webhookId: hook.id, webhookSecretEncrypted: encryptAccessToken(hook.secret), status: "active", statusDetail: null, updatedAt: new Date() })
    .where(eq(clickupConnection.agencyId, agencyId));
}

/** Desconecta: apaga o webhook no ClickUp e a conexão. Agendamentos já criados continuam. */
export async function disconnect(actor: BackofficeActor, agencyId: string) {
  const { connection, token } = await requireConnection(actor, agencyId);
  if (connection.webhookId) await deleteWebhook(token, connection.webhookId).catch(() => undefined);
  await db.delete(clickupConnection).where(eq(clickupConnection.agencyId, agencyId));
}

/** Estado para a tela, sem token nem segredo. */
export async function connectionView(actor: BackofficeActor, agencyId: string) {
  assertManage(actor, agencyId);
  const connection = await getConnection(agencyId);
  return {
    configured: clickupCredentials() !== null,
    connection: connection
      ? {
          status: connection.status,
          statusDetail: connection.statusDetail,
          clickupUserEmail: connection.clickupUserEmail,
          teamId: connection.teamId,
          teamName: connection.teamName,
          mapping: connection.mapping as Omit<MappingInput, "teamId" | "teamName"> | null,
          webhookActive: Boolean(connection.webhookId),
        }
      : null,
  };
}
