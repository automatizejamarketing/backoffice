export const BACKOFFICE_ROLE_VALUES = [
  "admin",
  "marketing_consultant",
] as const;

export type BackofficeRole = (typeof BACKOFFICE_ROLE_VALUES)[number];

export type BackofficePermission =
  | "dashboard:view"
  | "users:manage"
  | "billing:manage"
  | "posts:manage"
  | "marketing:read"
  | "marketing:write"
  | "affiliates:manage"
  | "masterclass:manage"
  | "team:manage";

export type BackofficeActorSource = "database" | "admin_email_fallback";

export type BackofficeActor = {
  id: string;
  email: string;
  name?: string | null;
  role: BackofficeRole;
  source: BackofficeActorSource;
  assignedUserIds?: string[];
};

export const USER_HUB_TAB_VALUES = [
  "summary",
  "subscription",
  "marketing",
  "usage",
  "content",
  "audit",
] as const;

export type UserHubTab = (typeof USER_HUB_TAB_VALUES)[number];

const ROLE_PERMISSIONS: Record<BackofficeRole, BackofficePermission[]> = {
  admin: [
    "dashboard:view",
    "users:manage",
    "billing:manage",
    "posts:manage",
    "marketing:read",
    "marketing:write",
    "affiliates:manage",
    "masterclass:manage",
    "team:manage",
  ],
  marketing_consultant: ["marketing:read", "marketing:write"],
};

export function hasBackofficePermission(
  actor: BackofficeActor,
  permission: BackofficePermission,
): boolean {
  return ROLE_PERMISSIONS[actor.role].includes(permission);
}

export function canAccessMarketingUser(
  actor: BackofficeActor,
  userId: string,
): boolean {
  if (actor.role === "admin") return true;
  return actor.assignedUserIds?.includes(userId) ?? false;
}

export function canAccessUserHubTab(
  actor: BackofficeActor,
  userId: string,
  tab: UserHubTab,
): boolean {
  if (actor.role === "admin") return true;
  return tab === "marketing" && canAccessMarketingUser(actor, userId);
}
