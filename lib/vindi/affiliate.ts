import type { VindiAffiliateStatus } from "@/lib/db/schema";
import { VindiApiError, type VindiClient } from "./client";
import { mapVindiAffiliateStatus } from "./affiliate-gate";

export type EnsureVindiAffiliateInput = {
  login: string;
  existingAffiliateId?: string | null;
};

export type EnsuredVindiAffiliate = {
  affiliateId: string;
  status: VindiAffiliateStatus;
  created: boolean;
};

type VindiAffiliateRecord = {
  id: number;
  login?: string;
  status?: unknown;
};

function normalizeAffiliateLogin(login: string): string {
  return login.trim().toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readAffiliate(payload: unknown): VindiAffiliateRecord | null {
  const record = asRecord(payload);
  if (!record) return null;
  const nested = asRecord(record.affiliate);
  const source = nested ?? record;
  if (typeof source.id !== "number") return null;
  return {
    id: source.id,
    login: typeof source.login === "string" ? source.login : undefined,
    status: source.status,
  };
}

function readAffiliateList(payload: unknown): VindiAffiliateRecord[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => {
      const affiliate = readAffiliate(item);
      return affiliate ? [affiliate] : [];
    });
  }
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.affiliates)) return [];
  return record.affiliates.flatMap((item) => {
    const affiliate = readAffiliate(item);
    return affiliate ? [affiliate] : [];
  });
}

function toEnsured(
  affiliate: VindiAffiliateRecord,
  created: boolean,
): EnsuredVindiAffiliate {
  return {
    affiliateId: String(affiliate.id),
    status: mapVindiAffiliateStatus(affiliate.status),
    created,
  };
}

function lookupPath(login: string): string {
  return `/v1/affiliates?query=${encodeURIComponent(`login=${login}`)}`;
}

async function findAffiliateByLogin(
  client: VindiClient,
  login: string,
): Promise<VindiAffiliateRecord | null> {
  const payload = await client.request<unknown>({
    method: "GET",
    path: lookupPath(login),
  });
  return (
    readAffiliateList(payload).find(
      (affiliate) =>
        affiliate.login?.trim().toLowerCase() === login,
    ) ?? null
  );
}

async function getAffiliateById(
  client: VindiClient,
  affiliateId: string,
): Promise<VindiAffiliateRecord> {
  const payload = await client.request<unknown>({
    method: "GET",
    path: `/v1/affiliates/${affiliateId}`,
  });
  const affiliate = readAffiliate(payload);
  if (!affiliate) {
    throw new Error("Vindi affiliate response is missing an id");
  }
  return affiliate;
}

async function refreshStoredAffiliate(
  client: VindiClient,
  affiliateId: string,
): Promise<VindiAffiliateRecord> {
  const current = await getAffiliateById(client, affiliateId);
  if (mapVindiAffiliateStatus(current.status) !== "rejected") {
    return current;
  }

  try {
    await client.request({
      method: "PUT",
      path: `/v1/affiliates/${affiliateId}/verify`,
    });
  } catch (error) {
    if (!(error instanceof VindiApiError)) throw error;
  }

  return getAffiliateById(client, affiliateId);
}

export async function ensureVindiAffiliate(
  client: VindiClient,
  input: EnsureVindiAffiliateInput,
): Promise<EnsuredVindiAffiliate> {
  const login = normalizeAffiliateLogin(input.login);
  if (!login) {
    throw new Error("expert email is required to create a Vindi affiliate");
  }

  if (input.existingAffiliateId) {
    return toEnsured(
      await refreshStoredAffiliate(client, input.existingAffiliateId),
      false,
    );
  }

  const existing = await findAffiliateByLogin(client, login);
  if (existing) return toEnsured(existing, false);

  try {
    const created = readAffiliate(
      await client.request<unknown>({
        method: "POST",
        path: "/v1/affiliates",
        body: { login },
      }),
    );
    if (!created) {
      throw new Error("Vindi affiliate create response is missing an id");
    }
    return toEnsured(created, true);
  } catch (error) {
    if (!(error instanceof VindiApiError) || error.status !== 422) {
      throw error;
    }
    const recovered = await findAffiliateByLogin(client, login);
    if (!recovered) throw error;
    return toEnsured(recovered, false);
  }
}
