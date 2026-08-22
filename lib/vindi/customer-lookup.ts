import type { VindiClient } from "./client";
import type { VindiCustomerAddress } from "./sandbox";
import type { VindiCustomer, VindiCustomerResponse } from "./types";

export type VindiCustomerDirectory = {
  getCustomerId(userId: string): Promise<string | null>;
  saveCustomerId(userId: string, vindiCustomerId: string): Promise<void>;
};

export type VindiCustomerIdentity = {
  userId: string;
  name: string;
  email: string;
  registryCode?: string;
  address?: VindiCustomerAddress;
};

function vindiCustomerProfileBody(buyer: VindiCustomerIdentity) {
  return {
    ...(buyer.registryCode ? { registry_code: buyer.registryCode } : {}),
    ...(buyer.address ? { address: buyer.address } : {}),
  };
}

/**
 * Um customer criado antes de o usuário ter CPF (ou sem o endereço que o
 * sandbox exige) recusa toda bill Pix ("CPF não pode ficar em branco"). O PUT
 * de melhor esforço completa o perfil quando temos os dados — igual ao
 * frontend.
 */
async function putVindiCustomerProfile(
  client: VindiClient,
  customerId: number,
  buyer: VindiCustomerIdentity,
): Promise<void> {
  const body = vindiCustomerProfileBody(buyer);
  if (!body.registry_code && !body.address) {
    return;
  }
  await client.request<VindiCustomerResponse>({
    method: "PUT",
    path: `/v1/customers/${customerId}`,
    body,
  });
}

export async function findOrCreateVindiCustomer(
  client: VindiClient,
  customers: VindiCustomerDirectory,
  buyer: VindiCustomerIdentity,
): Promise<number> {
  const stored = await customers.getCustomerId(buyer.userId);
  if (stored) {
    const customerId = Number(stored);
    await putVindiCustomerProfile(client, customerId, buyer);
    return customerId;
  }

  const listed = await client.request<{ customers: VindiCustomer[] }>({
    method: "GET",
    path: `/v1/customers?query=${encodeURIComponent(`code:${buyer.userId}`)}`,
  });
  const existing = listed.customers[0];
  if (existing) {
    await customers.saveCustomerId(buyer.userId, String(existing.id));
    await putVindiCustomerProfile(client, existing.id, buyer);
    return existing.id;
  }

  const created = await client.request<VindiCustomerResponse>({
    method: "POST",
    path: "/v1/customers",
    body: {
      name: buyer.name,
      email: buyer.email,
      code: buyer.userId,
      ...vindiCustomerProfileBody(buyer),
      metadata: { app_user_id: buyer.userId },
    },
  });
  await customers.saveCustomerId(buyer.userId, String(created.customer.id));
  return created.customer.id;
}
