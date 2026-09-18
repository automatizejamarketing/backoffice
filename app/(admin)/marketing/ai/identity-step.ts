/** The slice of a marketing page the identity step reads. */
export type IdentityPage = {
  pageId: string;
  instagramBusinessAccountId?: string | null;
  /** Primary identity of the client's fixed asset selection, when one exists. */
  primary?: boolean;
};

export type CampaignIdentity = { pageId: string; instagramUserId?: string };

/**
 * The identity step is asked only when the operator really has a choice: two or more pages. The
 * backoffice lists every page the client's token reaches (the selection flags are badges, not a
 * filter), so the count is the whole list.
 */
export function hasIdentityChoice(pages: readonly IdentityPage[]): boolean {
  return pages.length >= 2;
}

/**
 * What the step opens with: the primary page of the client's fixed selection when there is one,
 * otherwise the first page — the silent default this flow always used.
 */
export function preselectIdentity(pages: readonly IdentityPage[]): CampaignIdentity | null {
  const page = pages.find((candidate) => candidate.primary) ?? pages[0];
  if (!page) return null;
  return {
    pageId: page.pageId,
    ...(page.instagramBusinessAccountId
      ? { instagramUserId: page.instagramBusinessAccountId }
      : {}),
  };
}
