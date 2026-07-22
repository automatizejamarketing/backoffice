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
  | "business:manage"
  | "affiliates:manage"
  | "trackable-links:manage"
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
  "business",
  "marketing",
  "conversations",
  "usage",
  "content",
  "audit",
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
    "users:manage",
    "billing:manage",
    "posts:manage",
    "marketing:read",
    "marketing:write",
    "business:manage",
    "affiliates:manage",
    "trackable-links:manage",
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
  return (
    CONSULTANT_USER_HUB_TABS.includes(tab) &&
    canAccessMarketingUser(actor, userId)
  );
}
