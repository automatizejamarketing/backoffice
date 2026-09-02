import { isVindiAlreadyInUseError, type VindiClient } from "./client";
import type { VindiCustomerAddress } from "./sandbox";
import type { VindiCustomer, VindiCustomerResponse } from "./types";

/**
 * Um Cliente Vindi por par (Conta, CPF) — ADR 0029.
 *
 * Na Vindi o único campo único por empresa é `code` (medido em produção:
 * e-mail e `registry_code` aceitam duplicata tanto no POST quanto no PUT).
 * Então o Cliente é resolvido SEMPRE por `code` derivado da Conta, nunca por
 * e-mail e nunca por CPF — casar por CPF era o que fazia uma segunda Conta
 * adotar o Cliente da primeira e estourar `users_vindi_customer_id_unique`.
 */
export type VindiCustomerRecord = {
  vindiCustomerId: string;
  /** CPF/CNPJ só dígitos, ou null enquanto o Primário não viu nenhum. */
  registryCode: string | null;
};

export type VindiCustomerDirectory = {
  /** O Cliente Primário da Conta, ou null se ela ainda não tem nenhum. */
  getPrimary(userId: string): Promise<VindiCustomerRecord | null>;
  /** O Cliente já vinculado a este CPF nesta Conta. */
  findByRegistryCode(
    userId: string,
    registryCode: string,
  ): Promise<VindiCustomerRecord | null>;
  /** Grava ou atualiza o vínculo; `isPrimary` também atualiza `users`. */
  saveCustomer(input: {
    userId: string;
    vindiCustomerId: string;
    vindiCode: string;
    registryCode: string | null;
    isPrimary: boolean;
  }): Promise<void>;
};

export type VindiCustomerIdentity = {
  userId: string;
  name: string;
  email: string;
  registryCode?: string;
  address?: VindiCustomerAddress;
};

/**
 * A chave determinística que reencontra o Cliente na Vindi. Sendo derivada, é
 * auto-curável: se o vínculo se perder no nosso banco, o `GET code=` traz o
 * Cliente de volta em vez de criar um duplicado.
 */
export function vindiCustomerCode(
  userId: string,
  registryCode: string | null,
): string {
  return registryCode ? `${userId}:${registryCode}` : userId;
}

/**
 * Forma canônica do documento. É load-bearing: o mesmo CPF chegando ora com
 * máscara ora sem geraria dois `code` diferentes, logo dois Clientes. Um
 * documento de comprimento inválido vira "sem CPF" — quem exige CPF já
 * validou antes (`parseVindiBillingProfile`), e derivar `code` de lixo é pior
 * do que cair no Primário.
 */
export function normalizeVindiRegistryCode(
  raw: string | null | undefined,
): string | null {
  const digits = raw?.replace(/\D/g, "") ?? "";
  return digits.length === 11 || digits.length === 14 ? digits : null;
}

function vindiCustomerProfileBody(
  buyer: VindiCustomerIdentity,
  registryCode: string | null,
) {
  return {
    ...(registryCode ? { registry_code: registryCode } : {}),
    ...(buyer.address ? { address: buyer.address } : {}),
  };
}

/**
 * Completa o perfil do Cliente. `registryCode` só vem preenchido quando o
 * Cliente ainda NÃO tem documento: o CPF do Cliente é imutável depois de
 * gravado (ADR 0029, decisão 3), senão trocaríamos o documento por baixo de um
 * mandato de Pix Automático ativo. Endereço continua atualizável — sem ele o
 * sandbox recusa bill Pix.
 */
async function putVindiCustomerProfile(
  client: VindiClient,
  customerId: number,
  buyer: VindiCustomerIdentity,
  registryCode: string | null,
): Promise<void> {
  const body = vindiCustomerProfileBody(buyer, registryCode);
  if (!body.registry_code && !body.address) {
    return;
  }
  try {
    await client.request<VindiCustomerResponse>({
      method: "PUT",
      path: `/v1/customers/${customerId}`,
      body,
    });
  } catch (error) {
    if (!isVindiAlreadyInUseError(error)) {
      throw error;
    }
  }
}

function vindiCustomerExactQuery(field: "code", value: string) {
  return `/v1/customers?query=${encodeURIComponent(`${field}=${value}`)}`;
}

async function listVindiCustomersByExactField(
  client: VindiClient,
  field: "code",
  value: string,
): Promise<VindiCustomer[]> {
  const path = vindiCustomerExactQuery(field, value);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const listed = await client.request<{ customers?: VindiCustomer[] }>({
      method: "GET",
      path,
    });
    if (listed === undefined) {
      continue;
    }
    return Array.isArray(listed.customers) ? listed.customers : [];
  }
  return [];
}

async function findVindiCustomerByCode(
  client: VindiClient,
  code: string,
): Promise<VindiCustomer | null> {
  const matches = await listVindiCustomersByExactField(client, "code", code);
  return matches[0] ?? null;
}

/**
 * Cria o Cliente com um `code` dado. Como `code` é o ÚNICO campo único na
 * Vindi, um 422 "já está em uso" aqui só pode ser corrida com um POST irmão do
 * mesmo `code` — e a recuperação é reler por `code`.
 */
async function createVindiCustomer(
  client: VindiClient,
  buyer: VindiCustomerIdentity,
  code: string,
  registryCode: string | null,
): Promise<number> {
  try {
    const created = await client.request<VindiCustomerResponse>({
      method: "POST",
      path: "/v1/customers",
      body: {
        name: buyer.name,
        email: buyer.email,
        code,
        ...vindiCustomerProfileBody(buyer, registryCode),
        metadata: { app_user_id: buyer.userId },
      },
    });
    return created.customer.id;
  } catch (error) {
    if (!isVindiAlreadyInUseError(error)) {
      throw error;
    }
    const recovered = await findVindiCustomerByCode(client, code);
    if (!recovered) {
      throw error;
    }
    return recovered.id;
  }
}

/**
 * O Cliente Primário da Conta (`code = userId`). Nasce já com o CPF quando a
 * primeira compra traz um.
 */
async function resolvePrimaryVindiCustomer(
  client: VindiClient,
  customers: VindiCustomerDirectory,
  buyer: VindiCustomerIdentity,
  registryCode: string | null,
): Promise<{ id: number; registryCode: string | null; justCreated: boolean }> {
  const stored = await customers.getPrimary(buyer.userId);
  if (stored) {
    return {
      id: Number(stored.vindiCustomerId),
      registryCode: normalizeVindiRegistryCode(stored.registryCode),
      justCreated: false,
    };
  }

  const existing = await findVindiCustomerByCode(client, buyer.userId);
  if (existing) {
    const known = normalizeVindiRegistryCode(existing.registry_code);
    await customers.saveCustomer({
      userId: buyer.userId,
      vindiCustomerId: String(existing.id),
      vindiCode: buyer.userId,
      registryCode: known,
      isPrimary: true,
    });
    return { id: existing.id, registryCode: known, justCreated: false };
  }

  const created = await createVindiCustomer(
    client,
    buyer,
    buyer.userId,
    registryCode,
  );
  await customers.saveCustomer({
    userId: buyer.userId,
    vindiCustomerId: String(created),
    vindiCode: buyer.userId,
    registryCode,
    isPrimary: true,
  });
  // O POST já levou CPF e endereço; um PUT aqui seria chamada à toa.
  return { id: created, registryCode, justCreated: true };
}

export async function findOrCreateVindiCustomer(
  client: VindiClient,
  customers: VindiCustomerDirectory,
  buyer: VindiCustomerIdentity,
): Promise<number> {
  const registryCode = normalizeVindiRegistryCode(buyer.registryCode);

  // Vínculo direto (Conta, CPF): resolve sem consultar a Vindi.
  if (registryCode) {
    const linked = await customers.findByRegistryCode(
      buyer.userId,
      registryCode,
    );
    if (linked) {
      const customerId = Number(linked.vindiCustomerId);
      await putVindiCustomerProfile(client, customerId, buyer, null);
      return customerId;
    }
  }

  const primary = await resolvePrimaryVindiCustomer(
    client,
    customers,
    buyer,
    registryCode,
  );

  // Cartão nunca manda CPF em nenhum fluxo, então cai sempre aqui — é o que
  // mantém os cartões salvos num Cliente só.
  if (!registryCode) {
    if (!primary.justCreated) {
      await putVindiCustomerProfile(client, primary.id, buyer, null);
    }
    return primary.id;
  }

  // O Primário adota o primeiro CPF que aparecer, e nunca mais troca.
  if (primary.registryCode === null) {
    await putVindiCustomerProfile(client, primary.id, buyer, registryCode);
    await customers.saveCustomer({
      userId: buyer.userId,
      vindiCustomerId: String(primary.id),
      vindiCode: buyer.userId,
      registryCode,
      isPrimary: true,
    });
    return primary.id;
  }

  if (primary.registryCode === registryCode) {
    if (!primary.justCreated) {
      await putVindiCustomerProfile(client, primary.id, buyer, null);
    }
    await customers.saveCustomer({
      userId: buyer.userId,
      vindiCustomerId: String(primary.id),
      vindiCode: buyer.userId,
      registryCode,
      isPrimary: true,
    });
    return primary.id;
  }

  // CPF diferente do que o Primário carrega: Cliente próprio, sob a mesma
  // Conta. É o que permite comprar de novo com outro documento sem reescrever
  // o histórico fiscal da compra anterior.
  const code = vindiCustomerCode(buyer.userId, registryCode);
  const customerId = await createVindiCustomer(
    client,
    buyer,
    code,
    registryCode,
  );
  await customers.saveCustomer({
    userId: buyer.userId,
    vindiCustomerId: String(customerId),
    vindiCode: code,
    registryCode,
    isPrimary: false,
  });
  return customerId;
}
