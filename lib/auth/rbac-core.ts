export const BACKOFFICE_ROLE_VALUES = [
  "admin",
  "dev",
  "marketing_consultant",
  "marketing_consultant_premium",
  "finance_viewer",
  "comercial",
  "agency_owner",
  "agency_member",
] as const;

export type BackofficeRole = (typeof BACKOFFICE_ROLE_VALUES)[number];

/**
 * Consultor de marketing, comum ou premium: pode receber clientes atribuídos.
 * O premium também mexe em qualquer cliente, como admin.
 */
export function isMarketingConsultantRole(role: BackofficeRole): boolean {
  return role === "marketing_consultant" || role === "marketing_consultant_premium";
}

/** Dono ou Membro de uma agência externa (ADR 0044/0045). */
export function isAgencyRole(role: BackofficeRole): boolean {
  return role === "agency_owner" || role === "agency_member";
}

/** Quem pode receber clientes atribuídos: consultores da Automatize e Membros/Donos de agência. */
export function canReceiveClients(role: BackofficeRole): boolean {
  return isMarketingConsultantRole(role) || isAgencyRole(role);
}

/**
 * Quem fica preso à lista `assignedUserIds`: o consultor comum (carteira atribuída) e as pessoas de
 * agência (o Dono recebe todos os clientes da agência; o Membro, os atribuídos a ele dentro dela).
 * O premium continua atribuível e vê alertas, carteira e marketing de todo mundo.
 */
export function consultantSeesOnlyAssignedClients(role: BackofficeRole): boolean {
  return role === "marketing_consultant" || isAgencyRole(role);
}

export type BackofficePermission =
  | "dashboard:view"
  | "finance:view"
  | "emails:view"
  | "whatsapp:campaigns"
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
  | "team:manage"
  /** Clientes e Membros da própria agência (Dono da Agência). */
  | "agency:manage"
  /** Mensagens ao cliente pela Mat, o WhatsApp da Automatize: só a equipe interna. */
  | "mat:outreach";

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
  /** Clientes a que o ator se limita quando `consultantSeesOnlyAssignedClients(role)`. */
  assignedUserIds?: string[];
  /** Agência da pessoa (Dono/Membro); ausente para a equipe Automatize. */
  agencyId?: string | null;
  /**
   * Clientes de agências externas, escondidos da equipe interna que vê "todos" (premium, dev,
   * comercial). Só o admin vê, para suporte (ADR 0044).
   */
  hiddenUserIds?: string[];
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
    "whatsapp:campaigns",
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
    "agency:manage",
    "mat:outreach",
  ],
  dev: [
    "dashboard:view",
    "emails:view",
    "whatsapp:campaigns",
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
    "mat:outreach",
  ],
  marketing_consultant: ["marketing:read", "marketing:write", "mat:outreach"],
  // Consultor com carteira que, como admin, mexe em tudo do cliente: ficha,
  // acesso, créditos, cobrança, campanhas e WhatsApp. Sem áreas internas.
  marketing_consultant_premium: [
    "users:manage",
    "users:read",
    "users:activate",
    "billing:manage",
    "marketing:read",
    "marketing:write",
    "mat:outreach",
    "whatsapp:view",
    "whatsapp:support-session",
  ],
  finance_viewer: ["finance:view"],
  // Time comercial: CRM, painel, usuários em leitura, ativação e contato.
  // Sem dinheiro (billing), sem alterar acesso/créditos, sem equipe.
  comercial: ["dashboard:view", "crm:manage", "users:read", "users:activate"],
  // Agência externa: só a camada de operação (Tráfego, Marketing, Alertas), presa aos clientes da
  // agência. Nada da plataforma Automatize (Painel, Usuários, Financeiro, CRM, Mat).
  agency_owner: ["marketing:read", "marketing:write", "agency:manage"],
  agency_member: ["marketing:read", "marketing:write"],
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

/**
 * Clientes que o ator vê, para filtros em SQL: só a lista dele (consultor comum, agência) ou todos
 * menos os escondidos (clientes de agências externas, para a equipe interna que não é admin).
 */
export type ClientScope = { only: string[] } | { except: string[] };

export function clientScopeOf(actor: BackofficeActor): ClientScope {
  if (consultantSeesOnlyAssignedClients(actor.role)) return { only: actor.assignedUserIds ?? [] };
  return { except: actor.hiddenUserIds ?? [] };
}

/** Remove da lista os clientes de agências externas que o ator não pode ver. */
export function withoutHiddenClients<T extends { userId: string }>(
  actor: BackofficeActor,
  rows: T[],
): T[] {
  if (!actor.hiddenUserIds?.length) return rows;
  const hidden = new Set(actor.hiddenUserIds);
  return rows.filter((row) => !hidden.has(row.userId));
}

export function canAccessMarketingUser(
  actor: BackofficeActor,
  userId: string,
): boolean {
  if (actor.hiddenUserIds?.includes(userId)) return false;
  if (hasFullUserAccess(actor)) return true;
  return actor.assignedUserIds?.includes(userId) ?? false;
}

export function canAccessUserHubTab(
  actor: BackofficeActor,
  userId: string,
  tab: UserHubTab,
): boolean {
  if (actor.hiddenUserIds?.includes(userId)) return false;
  if (hasFullUserAccess(actor)) return true;
  // A conversa com a Mat é do suporte da Automatize com a conta, não da agência.
  if (isAgencyRole(actor.role) && tab === "conversations") return false;
  return (
    CONSULTANT_USER_HUB_TABS.includes(tab) &&
    canAccessMarketingUser(actor, userId)
  );
}
