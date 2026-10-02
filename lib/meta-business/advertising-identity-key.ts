/** Pure helpers: safe to import from clients and authorization policies. */
export function advertisingIdentityId(pageId: string, instagramBusinessAccountId: string): string {
  return `${pageId}:${instagramBusinessAccountId}`;
}

export function identityKey(identity: { identityId?: string; pageId: string }): string {
  return identity.identityId ?? identity.pageId;
}

export function parseAdvertisingIdentityId(identityId: string): {
  pageId: string;
  instagramBusinessAccountId: string;
} | null {
  const parts = identityId.split(":");
  return parts.length === 2 && parts.every(part => part.length > 0 && part.trim() === part)
    ? { pageId: parts[0], instagramBusinessAccountId: parts[1] }
    : null;
}

/** Accept stored legacy Page-only keys as well as pair keys. */
export function advertisingIdentityPageId(identityId: string): string {
  return parseAdvertisingIdentityId(identityId)?.pageId ?? identityId;
}
