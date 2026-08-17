import type { VindiClient } from "./client";
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
};

export async function findOrCreateVindiCustomer(
  client: VindiClient,
  customers: VindiCustomerDirectory,
  buyer: VindiCustomerIdentity,
): Promise<number> {
  const stored = await customers.getCustomerId(buyer.userId);
  if (stored) return Number(stored);

  const listed = await client.request<{ customers: VindiCustomer[] }>({
    method: "GET",
    path: `/v1/customers?query=${encodeURIComponent(`code:${buyer.userId}`)}`,
  });
  const existing = listed.customers[0];
  if (existing) {
    await customers.saveCustomerId(buyer.userId, String(existing.id));
    return existing.id;
  }

  const created = await client.request<VindiCustomerResponse>({
    method: "POST",
    path: "/v1/customers",
    body: {
      name: buyer.name,
      email: buyer.email,
      code: buyer.userId,
      metadata: { app_user_id: buyer.userId },
    },
  });
  await customers.saveCustomerId(buyer.userId, String(created.customer.id));
  return created.customer.id;
}
