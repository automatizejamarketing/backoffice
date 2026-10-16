import "server-only";

import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  metaBusinessAccount,
  metaConsultantCredential,
  metaEnabledAsset,
} from "@/lib/db/schema";
import { metaApiCall } from "./api";
import { appSecretProofParam, facebookAppSecret } from "./appsecret-proof";
import { graphApiVersion, graphFacebookBaseUrl } from "./constant";
import {
  matchPortfolioAccess,
  uniqueCandidates,
  type CredentialPortfolios,
  type PortfolioCandidate,
  type PortfolioAccessStatus,
  type PortfolioMatch,
} from "./portfolio-access";
import { decryptAccessToken } from "./token-vault";

/** /me/businesses pages per saved Facebook (100 each). */
const MAX_BUSINESS_PAGES = 5;

type BusinessNode = { id: string; name?: string; permitted_roles?: string[] };
type Paged<T> = { data?: T[]; paging?: { cursors?: { after?: string }; next?: string } };

export type PortfolioAccessReport = {
  status: PortfolioAccessStatus;
  matches: PortfolioMatch[];
  /** Portfolios we know belong to the client. */
  businesses: PortfolioCandidate[];
  credentials: { usable: number; failed: number };
  /** The signed-in consultant has a saved Facebook. */
  viewerHasCredential: boolean;
  connection: { status: string | null; tokenKind: string | null };
};

type UsableCredential = {
  actorAdminId: string;
  actorAdminEmail: string;
  name: string | null;
  token: string;
};

async function listBusinesses(token: string): Promise<BusinessNode[]> {
  const out: BusinessNode[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_BUSINESS_PAGES; page += 1) {
    const params = new URLSearchParams({
      fields: "id,name,permitted_roles",
      limit: "100",
      ...(after ? { after } : {}),
    });
    const res = await metaApiCall<Paged<BusinessNode>>({
      method: "GET",
      path: "me/businesses",
      params: params.toString(),
      accessToken: token,
    });
    out.push(...(res.data ?? []));
    after = res.paging?.cursors?.after;
    if (!res.paging?.next || !after) break;
  }
  return out;
}

/** Owner portfolio of an ad account, read with any saved Facebook that can open it. */
async function businessOfAdAccount(
  accountId: string,
  credentials: UsableCredential[],
): Promise<PortfolioCandidate | null> {
  const id = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  for (const credential of credentials) {
    try {
      const res = await metaApiCall<{ business?: { id: string; name?: string } }>({
        method: "GET",
        path: id,
        params: "fields=business{id,name}",
        accessToken: credential.token,
      });
      if (res.business?.id) {
        return { businessId: res.business.id, name: res.business.name ?? null };
      }
    } catch {
      // This Facebook cannot open the account; try the next one.
    }
  }
  return null;
}

/** Portfolios scanned at most when the client's portfolio is unknown. */
const MAX_SCANNED_PORTFOLIOS = 120;
const SCAN_CONCURRENCY = 8;

/**
 * Personal logins never stored the client's portfolio. A BM admin may not be
 * assigned to the ad account itself, so look for the account among the
 * accounts owned by every portfolio a saved Facebook administers.
 */
async function findOwnerAmongAdminPortfolios(
  accountIds: string[],
  listed: Array<{ credential: UsableCredential; businesses: BusinessNode[] }>,
): Promise<PortfolioCandidate | null> {
  const wanted = new Set(accountIds.map((id) => id.replace(/^act_/, "")));
  const queue: Array<{ business: BusinessNode; token: string }> = [];
  const seen = new Set<string>();
  for (const { credential, businesses } of listed) {
    for (const business of businesses) {
      if (seen.has(business.id) || !business.permitted_roles?.includes("ADMIN")) continue;
      seen.add(business.id);
      queue.push({ business, token: credential.token });
    }
  }

  let found: PortfolioCandidate | null = null;
  const work = queue.slice(0, MAX_SCANNED_PORTFOLIOS);
  const next = async () => {
    while (!found && work.length > 0) {
      const item = work.shift()!;
      // Plain fetch, not metaApiCall: most portfolios answer #100 (the login
      // granted business_management only to some of them) and that is
      // expected here, not a Meta failure worth an error log each.
      const proof = appSecretProofParam(item.token, facebookAppSecret());
      const url = `${graphFacebookBaseUrl}/${graphApiVersion}/${item.business.id}/owned_ad_accounts?fields=account_id&limit=200${proof ? `&${proof}` : ""}`;
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${item.token}` } });
        if (!res.ok) continue;
        const body = (await res.json()) as Paged<{ account_id?: string }>;
        if ((body.data ?? []).some((account) => account.account_id && wanted.has(account.account_id))) {
          found = { businessId: item.business.id, name: item.business.name ?? null };
        }
      } catch {
        // Network hiccup; keep scanning.
      }
    }
  };
  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, next));
  return found;
}

async function loadCredentials(): Promise<{
  usable: UsableCredential[];
  failed: number;
}> {
  const rows = await db
    .select()
    .from(metaConsultantCredential)
    .where(
      or(
        isNull(metaConsultantCredential.tokenExpiresAt),
        gt(metaConsultantCredential.tokenExpiresAt, new Date()),
      ),
    );
  const usable: UsableCredential[] = [];
  let failed = 0;
  for (const row of rows) {
    try {
      usable.push({
        actorAdminId: row.actorAdminId,
        actorAdminEmail: row.actorAdminEmail,
        name: row.name,
        token: decryptAccessToken(row.accessToken),
      });
    } catch {
      failed += 1;
    }
  }
  return { usable, failed };
}

/**
 * Is the client's portfolio already shared with someone at Automatize? Reads
 * only: GET /me/businesses for every saved consultant Facebook, plus the
 * owner portfolio of the client's enabled ad accounts when no connection ever
 * stored it (personal logins).
 */
export async function checkPortfolioAccess(args: {
  userId: string;
  viewerAdminId: string;
}): Promise<PortfolioAccessReport> {
  const [connections, enabled, loaded] = await Promise.all([
    db
      .select({
        clientBusinessId: metaBusinessAccount.clientBusinessId,
        assignedAssets: metaBusinessAccount.assignedAssets,
        connectionStatus: metaBusinessAccount.connectionStatus,
        tokenKind: metaBusinessAccount.tokenKind,
        deletedAt: metaBusinessAccount.deletedAt,
        updatedAt: metaBusinessAccount.updatedAt,
      })
      .from(metaBusinessAccount)
      .where(eq(metaBusinessAccount.userId, args.userId)),
    db
      .select({ assetId: metaEnabledAsset.assetId })
      .from(metaEnabledAsset)
      .where(
        and(
          eq(metaEnabledAsset.userId, args.userId),
          eq(metaEnabledAsset.assetKind, "ad_account"),
        ),
      ),
    loadCredentials(),
  ]);

  // Deleted rows count too: a client whose connection was removed still owns
  // the same portfolio.
  const candidates: PortfolioCandidate[] = [];
  for (const row of connections) {
    if (row.clientBusinessId) {
      candidates.push({ businessId: row.clientBusinessId, name: null });
    }
    for (const account of row.assignedAssets?.adAccounts ?? []) {
      if (account.businessId) {
        candidates.push({ businessId: account.businessId, name: null });
      }
    }
  }
  const listed: Array<{ credential: UsableCredential; businesses: BusinessNode[] }> = [];
  let failed = loaded.failed;
  await Promise.all(
    loaded.usable.map(async (credential) => {
      try {
        listed.push({ credential, businesses: await listBusinesses(credential.token) });
      } catch {
        failed += 1;
      }
    }),
  );

  if (uniqueCandidates(candidates).length === 0 && enabled.length > 0) {
    const accountIds = enabled.map(({ assetId }) => assetId);
    const found =
      (await businessOfAdAccount(accountIds[0], loaded.usable)) ??
      (await findOwnerAmongAdminPortfolios(accountIds, listed));
    if (found) candidates.push(found);
  }

  const credentials: CredentialPortfolios[] = listed.map(({ credential, businesses }) => ({
    name: credential.name,
    actorAdminEmail: credential.actorAdminEmail,
    businesses,
  }));

  const { status, matches } = matchPortfolioAccess({ candidates, credentials });
  const active = connections
    .filter((row) => !row.deletedAt)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

  return {
    status,
    matches,
    businesses: uniqueCandidates(candidates),
    credentials: { usable: credentials.length, failed },
    viewerHasCredential: loaded.usable.some(
      (credential) => credential.actorAdminId === args.viewerAdminId,
    ),
    connection: {
      status: active?.connectionStatus ?? null,
      tokenKind: active?.tokenKind ?? null,
    },
  };
}
