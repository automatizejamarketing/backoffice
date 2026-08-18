const PREFERRED_EMV_KEYS = [
  "qrcode_original_path",
  "qr_code",
  "pix_copy_and_paste",
  "copy_and_paste",
  "emv",
] as const;

const PIX_EMV_PREFIX = "000201";
const PIX_GUID = "br.gov.bcb.pix";
const PIX_CRC_SUFFIX = /6304[0-9A-Fa-f]{4}$/;

export type ParsedVindiPixEmv = {
  ok: true;
  emvPayload: string;
  sourceKey: string;
};

export type UnknownVindiPixEmv = {
  ok: false;
  reason: "missing" | "unknown_shape";
  fieldKeys: string[];
};

export type ParseVindiPixEmvResult = ParsedVindiPixEmv | UnknownVindiPixEmv;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPixEmvPayload(value: string): boolean {
  const payload = value.trim();
  return (
    payload.startsWith(PIX_EMV_PREFIX) &&
    payload.toLowerCase().includes(PIX_GUID) &&
    PIX_CRC_SUFFIX.test(payload)
  );
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function collectStringFields(
  value: unknown,
  prefix = "",
): Array<{ key: string; value: string }> {
  if (typeof value === "string") {
    const asObject = parseJsonObject(value);
    if (asObject) return collectStringFields(asObject, prefix);
    return prefix ? [{ key: prefix, value }] : [];
  }
  if (!isRecord(value)) return [];

  return Object.entries(value).flatMap(([key, entry]) => {
    if (key.startsWith("_")) return [];
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === "string") {
      const nested = parseJsonObject(entry);
      return nested
        ? collectStringFields(nested, path)
        : [{ key: path, value: entry }];
    }
    if (Array.isArray(entry)) {
      return entry.flatMap((item, index) =>
        collectStringFields(item, `${path}[${index}]`),
      );
    }
    if (isRecord(entry)) return collectStringFields(entry, path);
    return [];
  });
}

function unwrapGatewayFields(value: unknown): unknown {
  if (typeof value === "string") {
    return parseJsonObject(value) ?? value;
  }
  if (!isRecord(value)) return value;

  if (value.gateway_response_fields !== undefined) {
    return unwrapGatewayFields(value.gateway_response_fields);
  }
  if (isRecord(value.last_transaction)) {
    return unwrapGatewayFields(value.last_transaction);
  }
  if (isRecord(value.bill)) {
    return unwrapGatewayFields(value.bill);
  }
  if (Array.isArray(value.charges) && value.charges[0] !== undefined) {
    return unwrapGatewayFields(value.charges[0]);
  }
  if (isRecord(value.payment)) {
    return unwrapGatewayFields(value.payment);
  }
  return value;
}

export function parseVindiPixEmv(input: unknown): ParseVindiPixEmvResult {
  if (input == null) {
    return { ok: false, reason: "missing", fieldKeys: [] };
  }

  const fields = collectStringFields(unwrapGatewayFields(input));
  const fieldKeys = fields.map((field) => field.key);

  for (const preferred of PREFERRED_EMV_KEYS) {
    const match = fields.find(
      (field) =>
        field.key === preferred || field.key.endsWith(`.${preferred}`),
    );
    if (match && isPixEmvPayload(match.value)) {
      return {
        ok: true,
        emvPayload: match.value.trim(),
        sourceKey: preferred,
      };
    }
  }

  const scanned = fields.find((field) => isPixEmvPayload(field.value));
  if (scanned) {
    const sourceKey = scanned.key.includes(".")
      ? (scanned.key.split(".").at(-1) ?? scanned.key)
      : scanned.key;
    return {
      ok: true,
      emvPayload: scanned.value.trim(),
      sourceKey,
    };
  }

  return {
    ok: false,
    reason: fieldKeys.length === 0 ? "missing" : "unknown_shape",
    fieldKeys,
  };
}

export function vindiPixEmvUnknownLogFields(
  result: UnknownVindiPixEmv,
): { reason: UnknownVindiPixEmv["reason"]; fieldKeys: string[] } {
  return {
    reason: result.reason,
    fieldKeys: result.fieldKeys,
  };
}
