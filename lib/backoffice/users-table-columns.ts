export const USERS_TABLE_COLUMNS_STORAGE_KEY =
  "automatize-backoffice.users-columns.v2";

export const USERS_TABLE_COLUMNS = [
  { id: "user", label: "Usuário", hideable: false },
  { id: "contact", label: "Contato", hideable: true },
  { id: "company", label: "Empresa", hideable: true },
  { id: "phone", label: "Telefone", hideable: true },
  { id: "plan", label: "Plano", hideable: true },
  { id: "status", label: "Status", hideable: true },
  { id: "expiration", label: "Expiração", hideable: true },
  { id: "campaign", label: "Campanha", hideable: true },
  { id: "performance", label: "Performance 7d", hideable: true },
  { id: "marketing", label: "Marketing", hideable: true },
  { id: "consultant", label: "Consultor", hideable: true },
  { id: "posts", label: "Posts", hideable: true },
  { id: "requests", label: "Requisições IA", hideable: true },
  { id: "tokens", label: "Tokens", hideable: true },
  { id: "cost", label: "Custo", hideable: true },
  { id: "actions", label: "Ações", hideable: false },
] as const;

export type UsersTableColumnId = (typeof USERS_TABLE_COLUMNS)[number]["id"];

export type UsersTableColumnPrefs = {
  order: UsersTableColumnId[];
  hidden: UsersTableColumnId[];
};

const COLUMN_IDS = USERS_TABLE_COLUMNS.map((column) => column.id);
const HIDEABLE_COLUMN_IDS = USERS_TABLE_COLUMNS.filter(
  (column) => column.hideable,
).map((column) => column.id);
const LEGACY_OPTIONAL_IDS = HIDEABLE_COLUMN_IDS.filter((id) => id !== "contact");

export function isUsersTableColumnHideable(id: UsersTableColumnId): boolean {
  return HIDEABLE_COLUMN_IDS.includes(id);
}

function isColumnId(value: unknown): value is UsersTableColumnId {
  return typeof value === "string" && COLUMN_IDS.includes(value as UsersTableColumnId);
}

function mergeOrder(stored: unknown): UsersTableColumnId[] {
  const seen = new Set<UsersTableColumnId>();
  const order: UsersTableColumnId[] = [];

  if (Array.isArray(stored)) {
    for (const value of stored) {
      if (!isColumnId(value) || seen.has(value)) continue;
      seen.add(value);
      order.push(value);
    }
  }

  for (const id of COLUMN_IDS) {
    if (seen.has(id)) continue;
    const defaultIndex = COLUMN_IDS.indexOf(id);
    let insertAt = order.length;
    for (let index = defaultIndex - 1; index >= 0; index -= 1) {
      const neighbor = order.indexOf(COLUMN_IDS[index]);
      if (neighbor !== -1) {
        insertAt = neighbor + 1;
        break;
      }
    }
    if (defaultIndex === 0) insertAt = 0;
    order.splice(insertAt, 0, id);
  }

  return order;
}

function sanitizeHidden(hidden: UsersTableColumnId[]): UsersTableColumnId[] {
  return HIDEABLE_COLUMN_IDS.filter((id) => hidden.includes(id));
}

export function defaultUsersTableColumnPrefs(): UsersTableColumnPrefs {
  return {
    order: [...COLUMN_IDS],
    hidden: [],
  };
}

export function parseUsersTableColumnPrefs(
  raw: string | null | undefined,
): UsersTableColumnPrefs {
  if (!raw) return defaultUsersTableColumnPrefs();

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (Array.isArray(parsed)) {
      const visible = new Set(parsed.filter(isColumnId));
      return {
        order: mergeOrder(COLUMN_IDS),
        hidden: LEGACY_OPTIONAL_IDS.filter((id) => !visible.has(id)),
      };
    }

    if (!parsed || typeof parsed !== "object") {
      return defaultUsersTableColumnPrefs();
    }

    const record = parsed as { order?: unknown; hidden?: unknown };
    const hidden = Array.isArray(record.hidden)
      ? record.hidden.filter(isColumnId)
      : [];

    return {
      order: mergeOrder(record.order),
      hidden: sanitizeHidden(hidden),
    };
  } catch {
    return defaultUsersTableColumnPrefs();
  }
}

export function serializeUsersTableColumnPrefs(
  prefs: UsersTableColumnPrefs,
): string {
  return JSON.stringify({
    order: mergeOrder(prefs.order),
    hidden: sanitizeHidden(prefs.hidden),
  });
}

export function visibleUsersTableColumns(
  prefs: UsersTableColumnPrefs,
): UsersTableColumnId[] {
  const hidden = new Set(sanitizeHidden(prefs.hidden));
  return mergeOrder(prefs.order).filter((id) => !hidden.has(id));
}

export function setUsersTableColumnVisible(
  prefs: UsersTableColumnPrefs,
  id: UsersTableColumnId,
  visible: boolean,
): UsersTableColumnPrefs {
  if (!isUsersTableColumnHideable(id)) {
    return {
      order: mergeOrder(prefs.order),
      hidden: sanitizeHidden(prefs.hidden),
    };
  }

  const hidden = visible
    ? prefs.hidden.filter((candidate) => candidate !== id)
    : prefs.hidden.includes(id)
      ? prefs.hidden
      : [...prefs.hidden, id];

  return {
    order: mergeOrder(prefs.order),
    hidden: sanitizeHidden(hidden),
  };
}

export function moveUsersTableColumnToIndex(
  prefs: UsersTableColumnPrefs,
  id: UsersTableColumnId,
  toIndex: number,
): UsersTableColumnPrefs {
  const order = mergeOrder(prefs.order);
  const fromIndex = order.indexOf(id);
  if (fromIndex < 0) return prefs;

  const nextIndex = Math.max(0, Math.min(toIndex, order.length - 1));
  if (fromIndex === nextIndex) return prefs;

  const next = [...order];
  const [column] = next.splice(fromIndex, 1);
  next.splice(nextIndex, 0, column);

  return { ...prefs, order: next };
}

export function moveUsersTableColumn(
  prefs: UsersTableColumnPrefs,
  id: UsersTableColumnId,
  direction: -1 | 1,
): UsersTableColumnPrefs {
  return moveUsersTableColumnToIndex(
    prefs,
    id,
    mergeOrder(prefs.order).indexOf(id) + direction,
  );
}
