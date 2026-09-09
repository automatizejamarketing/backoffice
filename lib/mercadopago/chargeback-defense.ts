import "server-only";

import { readProductAssetBytes } from "@/lib/storage/product-assets-r2";
import {
  MAX_DEFENCE_FILE_BYTES,
  type DisputeDefenceFile,
  type DisputeDefenceProvider,
} from "@/lib/products/dispute-defense";

const API_BASE = "https://api.mercadopago.com";

type ChargebackState = {
  id?: string | number;
  documentation_status?: string;
  documentation?: Array<{ uuid?: string; id?: string | number }>;
};

function providerError(status: number, body: unknown) {
  const error = new Error(`mercadopago_chargeback_${status}`);
  Object.assign(error, { status, body });
  return error;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function getChargeback(input: {
  chargebackId: string;
  accessToken: string;
  callerId: string;
}): Promise<ChargebackState> {
  const response = await fetch(`${API_BASE}/v1/chargebacks/${encodeURIComponent(input.chargebackId)}`, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "X-Caller-Id": input.callerId,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await readJson(response);
  if (!response.ok) throw providerError(response.status, body);
  return (body ?? {}) as ChargebackState;
}

async function toBlob(file: DisputeDefenceFile): Promise<Blob> {
  if (!file.storageKey) throw new Error("defence_file_storage_key_missing");
  const bytes = await readProductAssetBytes(file.storageKey, MAX_DEFENCE_FILE_BYTES);
  if (bytes.byteLength !== file.size || bytes.byteLength === 0) {
    throw new Error("defence_file_size_mismatch");
  }
  return new Blob([Buffer.from(bytes)], { type: file.contentType });
}

/** Mercado Pago permits the collector to upload documentation only once. The
 * read-before-write boundary is deliberately part of the provider adapter. */
export function createMercadoPagoChargebackDefenceProvider(input: {
  chargebackId: string;
  accessToken: string;
  callerId: string;
  idempotencyKey: string;
}): DisputeDefenceProvider {
  return {
    async findSubmission({ providerAccountId }) {
      if (!providerAccountId || providerAccountId !== input.callerId) {
        throw new Error("defence_original_provider_account_mismatch");
      }
      const chargeback = await getChargeback(input);
      const files = chargeback.documentation ?? [];
      if (files.length === 0 || chargeback.documentation_status === "pending") return null;
      return {
        id: String(files[0]?.uuid ?? files[0]?.id ?? chargeback.id ?? input.chargebackId),
        result: chargeback.documentation_status ?? "submitted",
      };
    },
    async submit({ providerAccountId, files }) {
      if (!providerAccountId || providerAccountId !== input.callerId) {
        throw new Error("defence_original_provider_account_mismatch");
      }
      const chargeback = await getChargeback(input);
      if (chargeback.documentation_status !== "pending") {
        throw new Error("mercadopago_chargeback_documentation_not_pending");
      }
      const form = new FormData();
      for (const file of files) {
        form.append("file", await toBlob(file), file.name);
      }
      const response = await fetch(`${API_BASE}/v1/chargebacks/${encodeURIComponent(input.chargebackId)}/documentation`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "X-Caller-Id": input.callerId,
          "X-Idempotency-Key": input.idempotencyKey,
        },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
      const body = await readJson(response);
      if (!response.ok) throw providerError(response.status, body);
      const uploaded = Array.isArray(body) ? body as Array<{ uuid?: string }> : [];
      return {
        id: String(uploaded[0]?.uuid ?? `chargeback:${input.chargebackId}:documentation`),
        result: "submitted",
      };
    },
  };
}
