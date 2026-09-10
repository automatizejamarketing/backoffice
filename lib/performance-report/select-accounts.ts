export type SelectableAccount = {
  id: string;
  accountId?: string;
  name?: string | null;
};

export type AccountScopeMode =
  | "explicit"
  | "automatize_managed"
  | "name_match"
  | "needs_choice";

export type AccountSelection = {
  mode: AccountScopeMode;
  selected: SelectableAccount[];
  skipped: SelectableAccount[];
  summary: string;
};

const NAME_STOP = new Set([
  "cliente",
  "conta",
  "user",
  "teste",
  "test",
  "pago",
  "prepaid",
]);

export function accountIdKey(id: string): string {
  return id.replace(/^act_/i, "").toLowerCase();
}

export function formatSelectableActId(id: string): string {
  const trimmed = id.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

function keysOf(account: SelectableAccount): string[] {
  return [account.id, account.accountId]
    .filter((value): value is string => Boolean(value))
    .map(accountIdKey);
}

export function toAccountKeySet(ids: string[]): Set<string> {
  return new Set(ids.map(accountIdKey));
}

export function accountInKeySet(
  account: SelectableAccount,
  keys: Set<string>,
): boolean {
  return keysOf(account).some((key) => keys.has(key));
}

export function significantNameTokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !NAME_STOP.has(token));
}

export function accountMatchesClientName(
  accountName: string | null | undefined,
  clientName: string | null | undefined,
): boolean {
  const accountTokens = significantNameTokens(accountName ?? "");
  const clientTokens = significantNameTokens(clientName ?? "");
  if (accountTokens.length === 0 || clientTokens.length === 0) return false;
  return clientTokens.some((token) =>
    accountTokens.some(
      (account) => account.includes(token) || token.includes(account),
    ),
  );
}

export function campaignHasManagedPrefix(
  name: string | null | undefined,
  prefix: string,
): boolean {
  if (!name || !prefix) return false;
  return name.trim().startsWith(prefix);
}

function accountLabel(account: SelectableAccount): string {
  return account.name?.trim() || formatSelectableActId(account.id);
}

export function buildAccountScopeSummary(input: {
  mode: AccountScopeMode;
  selected: SelectableAccount[];
  skipped: SelectableAccount[];
}): string {
  const selectedLabels = input.selected.map(accountLabel);
  const skippedLabels = input.skipped.map(accountLabel);
  const skippedSuffix = skippedLabels.length
    ? ` Fora do escopo: ${skippedLabels.join(", ")}.`
    : "";

  if (input.mode === "explicit") {
    return `Escopo desta análise: a conta pedida (${selectedLabels.join(", ")}).${skippedSuffix}`;
  }
  if (input.mode === "needs_choice") {
    const connected = [...input.selected, ...input.skipped].map(accountLabel);
    return `Nenhuma conta com campanha criada pelo Automatize. Contas conectadas: ${connected.join(", ") || "nenhuma"}. Peça qual conta analisar — não consolide as outras empresas.`;
  }
  if (input.mode === "name_match") {
    const who =
      selectedLabels.length === 1
        ? `somente a conta ${selectedLabels[0]} (nome do cliente)`
        : `contas que batem com o nome do cliente — ${selectedLabels.join(", ")}`;
    return `Escopo desta análise: ${who}.${skippedSuffix}`;
  }
  const who =
    selectedLabels.length === 1
      ? `somente a conta ${selectedLabels[0]} (campanha criada pelo Automatize)`
      : `contas com campanha criada pelo Automatize — ${selectedLabels.join(", ")}`;
  return `Escopo desta análise: ${who}.${skippedSuffix}`;
}

export function selectReportAccounts(input: {
  connected: SelectableAccount[];
  explicitAccountId?: string | null;
  managedAccountIds: string[];
  liveManagedAccountIds?: string[];
  clientName?: string | null;
}): AccountSelection {
  const connected = input.connected;

  if (input.explicitAccountId?.trim()) {
    const wanted = accountIdKey(input.explicitAccountId);
    const hit = connected.filter((account) => keysOf(account).includes(wanted));
    const selected = hit.length
      ? hit
      : [
          {
            id: formatSelectableActId(input.explicitAccountId),
            name: input.explicitAccountId,
          },
        ];
    const selectedKeys = toAccountKeySet(selected.map((account) => account.id));
    const skipped = connected.filter(
      (account) => !accountInKeySet(account, selectedKeys),
    );
    return {
      mode: "explicit",
      selected,
      skipped,
      summary: buildAccountScopeSummary({
        mode: "explicit",
        selected,
        skipped,
      }),
    };
  }

  const managedKeys = toAccountKeySet([
    ...input.managedAccountIds,
    ...(input.liveManagedAccountIds ?? []),
  ]);
  if (managedKeys.size > 0) {
    const selected = connected.filter((account) =>
      accountInKeySet(account, managedKeys),
    );
    if (selected.length > 0) {
      const skipped = connected.filter(
        (account) => !accountInKeySet(account, managedKeys),
      );
      return {
        mode: "automatize_managed",
        selected,
        skipped,
        summary: buildAccountScopeSummary({
          mode: "automatize_managed",
          selected,
          skipped,
        }),
      };
    }
  }

  const nameHits = connected.filter((account) =>
    accountMatchesClientName(account.name, input.clientName),
  );
  if (nameHits.length > 0) {
    const skipped = connected.filter(
      (account) =>
        !accountInKeySet(account, toAccountKeySet(nameHits.map((row) => row.id))),
    );
    return {
      mode: "name_match",
      selected: nameHits,
      skipped,
      summary: buildAccountScopeSummary({
        mode: "name_match",
        selected: nameHits,
        skipped,
      }),
    };
  }

  return {
    mode: "needs_choice",
    selected: [],
    skipped: connected,
    summary: buildAccountScopeSummary({
      mode: "needs_choice",
      selected: [],
      skipped: connected,
    }),
  };
}
