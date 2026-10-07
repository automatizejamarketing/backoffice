/**
 * Which ad accounts an automated analysis should look at, given what the
 * connection sees and what the client enabled (meta_enabled_assets).
 *
 * Pure: the caller loads both lists. The enabled set is the client's own
 * choice (principal + não principais), so every analysis covers all of it,
 * principal first. An account the client enabled but the token no longer sees
 * is dropped — there is nothing to read there.
 */

export type EnabledAdAccountRow = {
  assetId: string;
  isPrimary: boolean;
};

export function bareAdAccountId(id: string): string {
  return id.trim().replace(/^act_/i, "");
}

/** Enabled ad account ids (bare), principal first, then the stored order. */
export function orderedEnabledAdAccountIds(
  rows: readonly EnabledAdAccountRow[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const ordered = [
    ...rows.filter((row) => row.isPrimary),
    ...rows.filter((row) => !row.isPrimary),
  ];
  for (const row of ordered) {
    const id = bareAdAccountId(row.assetId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Visible accounts that the client enabled, in enabled order (principal
 * first). `keysOf` returns every id form the visible row carries.
 */
export function pickEnabledVisibleAccounts<T>(input: {
  visible: readonly T[];
  enabledIds: readonly string[];
  keysOf: (account: T) => Array<string | null | undefined>;
}): T[] {
  const byKey = new Map<string, T>();
  for (const account of input.visible) {
    for (const key of input.keysOf(account)) {
      if (key) byKey.set(bareAdAccountId(key), account);
    }
  }
  const picked: T[] = [];
  for (const id of input.enabledIds) {
    const account = byKey.get(bareAdAccountId(id));
    if (account && !picked.includes(account)) picked.push(account);
  }
  return picked;
}
