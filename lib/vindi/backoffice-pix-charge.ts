import type { PlanType, VindiPaymentLinkSource } from "@/lib/db/schema";
import { assertPixRenewalAllowed } from "@/lib/backoffice/pix-renewal-policy";
import {
  presentBackofficeVindiPixLink,
  findReusableVindiPixLink,
  resolveVindiPixLinkExpiresAt,
  vindiBackofficeLinksToSupersede,
  type BackofficeVindiPixLinkView,
} from "./backoffice-pix";
import { vindiPixAddressForEnv } from "./sandbox";
import { VindiApiError, type VindiClient } from "./client";
import {
  findOrCreateVindiCustomer,
  type VindiCustomerDirectory,
  type VindiCustomerIdentity,
} from "./customer-lookup";
import { resourceId } from "./payload";
import {
  parseVindiPixEmv,
  vindiPixEmvUnknownLogFields,
} from "./pix-emv";
import {
  buildVindiPixQrBillRequest,
  quoteBackofficeVindiPixAmount,
} from "./subscription-pix-qr";
import type { VindiBillResponse, VindiProductsResponse } from "./types";

export type StoredBackofficeVindiPixLink = {
  id: string;
  userId: string;
  planType: PlanType | null;
  amount: number;
  currency: string;
  emvPayload: string | null;
  vindiBillId: string | null;
  vindiChargeId: string | null;
  status: string;
  source: VindiPaymentLinkSource | string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt?: Date;
};

export type BackofficeVindiPixStore = {
  listOpenLinks(userId: string): Promise<StoredBackofficeVindiPixLink[]>;
  persistLink(input: {
    userId: string;
    planType: PlanType;
    amount: number;
    emvPayload: string;
    vindiBillId: string;
    vindiChargeId: string | null;
    expiresAt: Date;
    now: Date;
  }): Promise<StoredBackofficeVindiPixLink>;
  markLinksSuperseded(ids: string[], now: Date): Promise<void>;
};

async function findVindiPlanProductId(
  client: VindiClient,
  planType: PlanType,
): Promise<number> {
  const existing = await client.request<VindiProductsResponse>({
    method: "GET",
    path: `/v1/products?query=${encodeURIComponent(`code=${planType}`)}`,
  });
  const found = existing.products.find((product) => product.code === planType);
  if (!found) {
    throw new Error(`Produto Vindi não encontrado para ${planType}`);
  }
  return found.id;
}

export async function deleteVindiBill(
  client: VindiClient,
  vindiBillId: string,
): Promise<void> {
  try {
    await client.request({
      method: "DELETE",
      path: `/v1/bills/${vindiBillId}`,
    });
  } catch (error) {
    if (error instanceof VindiApiError && error.status === 404) return;
    throw error;
  }
}

/** Prazo que a Vindi informou para esta fatura Pix, se informou algum. */
function vindiReportedPixExpiry(bill: unknown): Date | null {
  if (bill === null || typeof bill !== "object") return null;
  const record = bill as {
    due_at?: unknown;
    charges?: Array<{
      last_transaction?: {
        gateway_response_fields?: Record<string, string | undefined>;
      };
    }>;
  };
  const fields = record.charges?.[0]?.last_transaction?.gateway_response_fields;
  const candidates = [fields?.max_days_to_keep_waiting_payment, record.due_at];
  for (const value of candidates) {
    if (typeof value !== "string" || !value.trim()) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

export async function createBackofficeVindiPixBill(input: {
  client: VindiClient;
  customers: VindiCustomerDirectory;
  buyer: VindiCustomerIdentity;
  planType: PlanType;
  pixMethodCode: string;
  vindiSubscriptionsEnabled: boolean;
  log?: (event: string, fields: Record<string, unknown>) => void;
}): Promise<{
  billId: string;
  chargeId: string | null;
  emvPayload: string;
  amountCentavos: number;
  gatewayExpiresAt: Date | null;
}> {
  if (input.vindiSubscriptionsEnabled !== true) {
    throw new Error("As cobranças Vindi de assinatura estão desligadas.");
  }

  const customerId = await findOrCreateVindiCustomer(
    input.client,
    input.customers,
    input.buyer,
  );
  const productId = await findVindiPlanProductId(input.client, input.planType);
  const created = await input.client.request<VindiBillResponse>({
    method: "POST",
    path: "/v1/bills",
    body: buildVindiPixQrBillRequest({
      customerId,
      productId,
      pixMethodCode: input.pixMethodCode,
      appUserId: input.buyer.userId,
      planType: input.planType,
    }),
  });

  const charge = created.bill.charges?.[0];
  const parsedEmv = parseVindiPixEmv(created.bill);
  if (!parsedEmv.ok) {
    const log = input.log ?? ((event, fields) => {
      console.info("[vindi/pix-emv]", event, fields);
    });
    log("unknown_pix_emv_shape", vindiPixEmvUnknownLogFields(parsedEmv));
    throw new Error("A Vindi não devolveu o Pix copia e cola.");
  }

  return {
    billId: String(created.bill.id),
    chargeId: resourceId(charge?.id),
    emvPayload: parsedEmv.emvPayload,
    amountCentavos: quoteBackofficeVindiPixAmount(input.planType),
    gatewayExpiresAt: vindiReportedPixExpiry(created.bill),
  };
}

export async function createOrReuseBackofficeVindiPix(input: {
  client: VindiClient;
  customers: VindiCustomerDirectory;
  store: BackofficeVindiPixStore;
  user: { id: string; name: string; email: string; registryCode?: string };
  subscriptions: Array<{
    provider?: string | null;
    status?: string | null;
  }>;
  planType: PlanType;
  pixMethodCode: string;
  vindiSubscriptionsEnabled: boolean;
  now: Date;
}): Promise<{ reused: boolean; link: BackofficeVindiPixLinkView }> {
  if (input.vindiSubscriptionsEnabled !== true) {
    throw new Error("As cobranças Vindi de assinatura estão desligadas.");
  }
  assertPixRenewalAllowed(input.subscriptions);

  const amount = quoteBackofficeVindiPixAmount(input.planType);
  const openLinks = await input.store.listOpenLinks(input.user.id);
  const stale = vindiBackofficeLinksToSupersede(openLinks, {
    planType: input.planType,
    amount,
  });
  if (stale.length > 0) {
    for (const link of stale) {
      if (link.vindiBillId) {
        await deleteVindiBill(input.client, link.vindiBillId);
      }
    }
    await input.store.markLinksSuperseded(
      stale.map((link) => link.id),
      input.now,
    );
  }

  const reusable = findReusableVindiPixLink(openLinks, {
    planType: input.planType,
    amount,
    now: input.now,
  });
  if (reusable) {
    return {
      reused: true,
      link: presentBackofficeVindiPixLink(reusable),
    };
  }

  const created = await createBackofficeVindiPixBill({
    client: input.client,
    customers: input.customers,
    buyer: {
      userId: input.user.id,
      name: input.user.name,
      email: input.user.email,
      registryCode: input.user.registryCode,
      address: vindiPixAddressForEnv(),
    },
    planType: input.planType,
    pixMethodCode: input.pixMethodCode,
    vindiSubscriptionsEnabled: input.vindiSubscriptionsEnabled,
  });

  const persisted = await input.store.persistLink({
    userId: input.user.id,
    planType: input.planType,
    amount: created.amountCentavos,
    emvPayload: created.emvPayload,
    vindiBillId: created.billId,
    vindiChargeId: created.chargeId,
    expiresAt: resolveVindiPixLinkExpiresAt({
      now: input.now,
      gatewayExpiresAt: created.gatewayExpiresAt,
    }),
    now: input.now,
  });

  return {
    reused: false,
    link: presentBackofficeVindiPixLink(persisted),
  };
}
