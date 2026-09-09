const CONTACT_KEY = /email|phone|telefone|hash|sample|linha|row|payload|identif/i;
const CONTACT_VALUE =
  /[^\s@]+@[^\s@]+\.[^\s@]+|\+\d{10,15}|[a-f0-9]{64}/i;

export type SanitizedCustomerFileHistory = {
  id: string;
  actorKind: "user" | "backoffice";
  actorId: string | null;
  customerId: string | null;
  adAccountId: string | null;
  audienceIdentity: string;
  audienceId: string | null;
  audienceName: string | null;
  operation: string;
  state: string;
  receivedAt: Date;
  updatedAt: Date;
  counts: Record<string, number>;
  previewConfirmed: boolean;
  declarationsConfirmed: boolean;
  receipts: Array<{ sequence: number; received?: number; rejected?: number }>;
  confirmedBatches: number[];
  sessionId: string | null;
  pendingUnresolved: boolean;
};

export function assertSanitizedHistory(
  record: SanitizedCustomerFileHistory,
): void {
  const serialized = JSON.stringify(record);
  if (CONTACT_VALUE.test(serialized)) {
    throw new Error("O histórico sanitizado não pode conter contato, hash ou amostra.");
  }
  for (const key of Object.keys(record)) {
    if (CONTACT_KEY.test(key) && key !== "audienceIdentity") {
      throw new Error("O histórico sanitizado não pode expor material de contato.");
    }
  }
}

export function parseJsonObject(value: unknown): Record<string, number> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
    );
  }
  if (typeof value === "string") {
    return parseJsonObject(JSON.parse(value));
  }
  return {};
}

export function parseNumberArray(value: unknown): number[] {
  const items = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(items) ? items.filter((item): item is number => typeof item === "number") : [];
}

export function parseReceipts(
  value: unknown,
): Array<{ sequence: number; received?: number; rejected?: number }> {
  const items = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object" || typeof item.sequence !== "number") return [];
    return [{
      sequence: item.sequence,
      ...(typeof item.received === "number" ? { received: item.received } : {}),
      ...(typeof item.rejected === "number" ? { rejected: item.rejected } : {}),
    }];
  });
}
