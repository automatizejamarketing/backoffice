export const BACKOFFICE_ROLE_VALUES = [
  "admin",
  "dev",
  "marketing_consultant",
  "marketing_consultant_premium",
  "finance_viewer",
  "comercial",
] as const;

export type BackofficeRole = (typeof BACKOFFICE_ROLE_VALUES)[number];

/**
 * Consultor de marketing, comum ou premium: tem carteira própria (clientes
 * atribuídos). O premium também mexe em qualquer cliente, como admin.
 */
export function isMarketingConsultantRole(role: BackofficeRole): boolean {
  return role === "marketing_consultant" || role === "marketing_consultant_premium";
}

export type BackofficePermission =
  | "dashboard:view"
  | "finance:view"
  | "emails:view"
  | "whatsapp:view"
  | "whatsapp:support-session"
  | "users:manage"
  /** Lista e ficha de usuários em leitura (sem créditos, acesso ou consultor). */
  | "users:read"
  /** Ativar conta e gerar link de ativação. */
  | "users:activate"
  /** CRM comercial: funil, anotações e metas. */
  | "crm:manage"
  | "billing:manage"
  | "posts:manage"
  | "marketing:read"
  | "marketing:write"
  | "business:manage"
  | "affiliates:manage"
  | "trackable-links:manage"
  | "masterclass:manage"
  | "products:manage"
  | "creative-analysis:manage"
  | "ambassadors:manage"
  | "ambassadors:grant"
  | "team:manage";

export type BackofficeActorSource =
  | "database"
  | "admin_email_fallback"
  | "finance_email_fallback";

export type BackofficeActor = {
  id: string;
  email: string;
  name?: string | null;
  role: BackofficeRole;
  /** Cargo comercial (gestor, SDR, consultor); rótulo, não permissão. */
  salesRole?: SalesRole | null;
  source: BackofficeActorSource;
  assignedUserIds?: string[];
  ambassadorAccess?: boolean;
  ambassadorGrant?: boolean;
};

export const SALES_ROLE_VALUES = [
  "gestor_comercial",
  "sdr",
  "consultor_comercial",
] as const;

export type SalesRole = (typeof SALES_ROLE_VALUES)[number];

export function isSalesRole(value: unknown): value is SalesRole {
  return SALES_ROLE_VALUES.includes(value as SalesRole);
}

/** Quem pode editar as metas do CRM: o gestor comercial ou um admin. */
export function canManageCrmGoals(actor: BackofficeActor): boolean {
  return actor.role === "admin" || actor.salesRole === "gestor_comercial";
}

export const USER_HUB_TAB_VALUES = [
  "summary",
  "subscription",
  "business",
  "marketing",
  "conversations",
  "whatsapp",
  "usage",
  "content",
  "audit",
  "whatsapp",
] as const;

export type UserHubTab = (typeof USER_HUB_TAB_VALUES)[number];

/**
 * Tabs a `marketing_consultant` may open, for users assigned to them.
 * `conversations` is here deliberately: the consultant serves the whole account,
 * so they read the user's Mat history in full — including passages that are not
 * about marketing (ADR 0018).
 */
const CONSULTANT_USER_HUB_TABS: readonly UserHubTab[] = [
  "business",
  "marketing",
  "conversations",
];

const ROLE_PERMISSIONS: Record<BackofficeRole, BackofficePermission[]> = {
  admin: [
    "dashboard:view",
    "finance:view",
    "emails:view",
    "whatsapp:view",
    "whatsapp:support-session",
    "users:manage",
    "users:read",
    "users:activate",
    "crm:manage",
    "billing:manage",
    "posts:manage",
    "marketing:read",
    "marketing:write",
    "business:manage",
    "affiliates:manage",
    "trackable-links:manage",
    "masterclass:manage",
    "products:manage",
    "creative-analysis:manage",
    "team:manage",
  ],
  dev: [
    "dashboard:view",
    "emails:view",
    "whatsapp:view",
    "whatsapp:support-session",
    "users:manage",
    "users:read",
    "users:activate",
    "crm:manage",
    "posts:manage",
    "marketing:read",
    "marketing:write",
    "trackable-links:manage",
    "masterclass:manage",
    "products:manage",
    "creative-analysis:manage",
  ],
  marketing_consultant: ["marketing:read", "marketing:write"],
  // Consultor com carteira que, como admin, mexe em tudo do cliente: ficha,
  // acesso, créditos, cobrança, campanhas e WhatsApp. Sem áreas internas.
  marketing_consultant_premium: [
    "users:manage",
    "users:read",
    "users:activate",
    "billing:manage",
    "marketing:read",
    "marketing:write",
    "whatsapp:view",
    "whatsapp:support-session",
  ],
  finance_viewer: ["finance:view"],
  // Time comercial: CRM, painel, usuários em leitura, ativação e contato.
  // Sem dinheiro (billing), sem alterar acesso/créditos, sem equipe.
  comercial: ["dashboard:view", "crm:manage", "users:read", "users:activate"],
};

function hasFullUserAccess(actor: BackofficeActor): boolean {
  return (
    actor.role === "admin" ||
    actor.role === "dev" ||
    actor.role === "comercial" ||
    actor.role === "marketing_consultant_premium"
  );
}

export function hasBackofficePermission(
  actor: BackofficeActor,
  permission: BackofficePermission,
): boolean {
  if (permission === "ambassadors:manage")
    return actor.role === "admin" || actor.ambassadorAccess === true;
  if (permission === "ambassadors:grant")
    return (
      actor.role === "admin" ||
      (actor.ambassadorAccess === true && actor.ambassadorGrant === true)
    );
  return ROLE_PERMISSIONS[actor.role].includes(permission);
}

export function canAccessMarketingUser(
  actor: BackofficeActor,
  userId: string,
): boolean {
  if (hasFullUserAccess(actor)) return true;
  return actor.assignedUserIds?.includes(userId) ?? false;
}

export function canAccessUserHubTab(
  actor: BackofficeActor,
  userId: string,
  tab: UserHubTab,
): boolean {
  if (hasFullUserAccess(actor)) return true;
  return (
    CONSULTANT_USER_HUB_TABS.includes(tab) &&
    canAccessMarketingUser(actor, userId)
  );
}
