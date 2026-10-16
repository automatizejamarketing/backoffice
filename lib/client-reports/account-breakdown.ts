import type { ClientReportAccountRow } from "./payload-schema";

export type AccountTotals = {
  spend: number;
  purchaseValue: number;
  purchases: number;
};

/**
 * Per-account rows for the report, in the client's order (principal first)
 * when there is a selection, else by spend. Accounts with no spend and no
 * sales in the window are left out — an empty row reads like a problem.
 */
export function accountRowsFromTotals(input: {
  byAccount: ReadonlyMap<string, AccountTotals>;
  order: readonly string[] | null;
  names: ReadonlyMap<string, string>;
}): ClientReportAccountRow[] {
  const rows = [...input.byAccount.entries()]
    .filter(([, totals]) => totals.spend > 0 || totals.purchaseValue > 0)
    .map(([accountId, totals]) => ({
      accountId,
      name: input.names.get(accountId) ?? accountId,
      spend: totals.spend,
      purchaseValue: totals.purchaseValue,
      purchases: totals.purchases,
      roas: totals.spend > 0 ? totals.purchaseValue / totals.spend : null,
    }));

  const position = new Map((input.order ?? []).map((id, index) => [id, index]));
  return rows.sort((a, b) => {
    const pa = position.get(a.accountId);
    const pb = position.get(b.accountId);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return b.spend - a.spend;
  });
}
