import "server-only";

import { metaApiCall } from "@/lib/meta-business/api";
import {
  assertCustomAudienceAccountAccess,
  getCustomAudienceDetail,
  listCustomAudiences,
} from "@/lib/meta-business/marketing/audiences/read";
import { createCustomerListAudience } from "@/lib/meta-business/marketing/audiences/customer-list-creation";
import { sendCustomerFileBatch } from "@/lib/meta-business/marketing/audiences/customer-file-operation";
import { sendCustomerListReplacementBatch } from "@/lib/meta-business/marketing/audiences/customer-list-replacement";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import { requireMarketingUserAccess } from "@/lib/auth/rbac";
import { customerFileDurableStore } from "@/lib/customer-file/postgres";
import {
  CustomerFileImportError,
  type CustomerFileImportActor,
  type CustomerFileImportDependencies,
} from "@/lib/customer-file/import-service";

function accountPath(adAccountId: string): string {
  return adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
}

function sameAdAccount(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/^act_/, "");
  return normalize(left) === normalize(right);
}

/** Resolves the target customer's connection and repeats backoffice RBAC. */
async function resolveAccess(adAccountId: string, actor: CustomerFileImportActor): Promise<string> {
  try {
    await requireMarketingUserAccess(actor.customerId, "marketing:write");
  } catch (error) {
    throw new CustomerFileImportError(
      "UNAUTHORIZED",
      error instanceof Error ? error.message : "O operador não pode acessar este cliente.",
    );
  }
  const token = await getUserAccessTokenByUserId(actor.customerId);
  if (!token.success) throw new CustomerFileImportError("UNAUTHORIZED", token.error.message);
  const connection = await getUserWithAdAccounts(token.accessToken, {
    tokenKind: token.connection.tokenKind,
    bisuAppScopedId: token.connection.bisuAppScopedId,
    clientBusinessId: token.connection.clientBusinessId,
    connectionName: token.connection.name,
  });
  try {
    assertCustomAudienceAccountAccess(adAccountId, connection.adaccounts?.data ?? []);
  } catch {
    throw new CustomerFileImportError("UNAUTHORIZED", "A conta de anúncios não está acessível nesta conexão.");
  }
  return token.accessToken;
}

async function readTermsState(adAccountId: string, accessToken: string) {
  try {
    const account = await metaApiCall<{ tos_accepted?: Record<string, number> }>({
      method: "GET",
      path: accountPath(adAccountId),
      params: "fields=tos_accepted",
      accessToken,
    });
    const accepted = Object.entries(account.tos_accepted ?? {}).some(
      ([key, value]) => key.includes("custom_audience") && Number(value) === 1,
    );
    return accepted
      ? { accepted: true }
      : { accepted: false, guidance: "Os termos de públicos de listas de clientes ainda não constam como aceitos para esta conta. Aceite-os explicitamente antes de enviar contatos." };
  } catch {
    return { accepted: false, guidance: "Não foi possível consultar o estado dos termos nesta conta. Confirme o aceite no Gerenciador de Anúncios; o Automatize não aceita termos em seu nome." };
  }
}

export function customerFileImportDependencies(input: {
  actor: CustomerFileImportActor;
  adAccountId: string;
  audienceId?: string;
}): CustomerFileImportDependencies {
  const { actor, adAccountId, audienceId } = input;
  return {
    store: customerFileDurableStore(),
    async authorize({ target }) {
      if (target.adAccountId && !sameAdAccount(target.adAccountId, adAccountId)) {
        throw new CustomerFileImportError("UNAUTHORIZED", "A operação pertence a outra conta de anúncios.");
      }
      const accessToken = await resolveAccess(adAccountId, actor);
      if (!target.audienceId) return;
      const audience = await getCustomAudienceDetail({ audienceId: target.audienceId, accessToken }).catch(() => null);
      if (!audience || audience.capabilities.manageMembers !== "available") {
        throw new CustomerFileImportError("UNAUTHORIZED", "O público não está acessível para alterar membros com as permissões atuais.");
      }
    },
    async termsState() {
      return readTermsState(adAccountId, await resolveAccess(adAccountId, actor));
    },
    async createAudience(request) {
      const accessToken = await resolveAccess(adAccountId, actor);
      const created = await createCustomerListAudience({ ...request, accessToken });
      if (!created.ok) throw new Error(created.issues.map((issue) => issue.code).join(","));
      return { id: created.id };
    },
    async send(request) {
      const accessToken = await resolveAccess(adAccountId, actor);
      if (request.operation === "replace") {
        return sendCustomerListReplacementBatch({ audienceId: request.audienceId, accessToken, batch: request.batch, sessionId: request.sessionId!, sequence: request.sequence, lastBatch: Boolean(request.lastBatch) });
      }
      return sendCustomerFileBatch({ audienceId: request.audienceId, accessToken, operation: request.operation, batch: request.batch, ...(request.sessionId ? { sessionId: request.sessionId } : {}) });
    },
    async revalidateRemote(request) {
      if (request && request.state !== "awaiting_confirmation") return { safeToContinue: false };
      const accessToken = await resolveAccess(adAccountId, actor);
      if (!audienceId) return { safeToContinue: true };
      return { safeToContinue: Boolean(await getCustomAudienceDetail({ audienceId, accessToken }).catch(() => null)) };
    },
    async reconcileCreation(pending) {
      const accessToken = await resolveAccess(adAccountId, actor);
      const page = await listCustomAudiences({ adAccountId: pending.adAccountId, accessToken }).catch(() => null);
      const match = page?.items.find((audience) => audience.name === pending.name);
      return match ? { id: match.id } : undefined;
    },
    async reconcileReplacement() {
      return { safeToContinue: false };
    },
  };
}
