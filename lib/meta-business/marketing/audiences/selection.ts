import type { SanitizedCustomerFileHistory } from "@/lib/customer-file/sanitize";
import { compromisesAudienceImport } from "./integrity";

export type AudienceSelectionPlacement = "include" | "exclude";

export type AudienceSelectionBlock = {
  audienceId: string;
  placement: AudienceSelectionPlacement;
  message: string;
  solution: string;
};

export type AudienceSelectionCheck =
  | { ok: true }
  | { ok: false; blocked: AudienceSelectionBlock[] };

export function checkAudienceSelectionFromHistory(input: {
  includedAudienceIds?: ReadonlyArray<string>;
  excludedAudienceIds?: ReadonlyArray<string>;
  history: ReadonlyMap<string, SanitizedCustomerFileHistory>;
}): AudienceSelectionCheck {
  const selections = [
    ...(input.includedAudienceIds ?? []).filter(Boolean).map((audienceId) => ({ audienceId, placement: "include" as const })),
    ...(input.excludedAudienceIds ?? []).filter(Boolean).map((audienceId) => ({ audienceId, placement: "exclude" as const })),
  ];
  const blocked = selections.flatMap(({ audienceId, placement }) => {
    const result = input.history.get(audienceId);
    if (!result || !compromisesAudienceHistory(result)) return [];
    return [{
      audienceId,
      placement,
      message: `O público ${audienceId} tem uma importação parcial ou incerta que pode não representar a lista pretendida.`,
      solution: "Corrija ou reconcilie a importação antes de publicar essa seleção, ou remova/troque o público.",
    }];
  });
  return blocked.length > 0 ? { ok: false, blocked } : { ok: true };
}

function compromisesAudienceHistory(history: SanitizedCustomerFileHistory): boolean {
  const confirmedRecords = history.receipts.reduce(
    (total, receipt) => total + Math.max(0, (receipt.received ?? 0) - (receipt.rejected ?? 0)),
    0,
  ) || Math.max(0, history.counts.confirmed ?? 0);
  const rejectedRecords = history.receipts.reduce(
    (total, receipt) => total + Math.max(0, receipt.rejected ?? 0),
    0,
  ) || Math.max(0, history.counts.rejected ?? 0);
  return compromisesAudienceImport(history.state, {
    pendingUnresolved: history.pendingUnresolved,
    confirmedBatches: history.confirmedBatches.length,
    confirmedRecords,
    rejectedRecords,
  });
}
