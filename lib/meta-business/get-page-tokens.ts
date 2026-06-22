import { metaApiCall } from "@/lib/meta-business/api";

type GraphMeAccountsResponse = {
  data?: Array<{ id?: string; access_token?: string }>;
  paging?: { cursors?: { after?: string }; next?: string };
};

/**
 * Fetches the access token of every Facebook Page the user manages, keyed by
 * page id.
 *
 * Why this exists: ad videos sourced from an existing Instagram/Page post are
 * owned by the Page, not the ad account. Reading such a video node
 * (`GET /{video-id}?fields=source`) with the user token fails with Meta error
 * code 10 ("Application does not have permission for this action"). The Page
 * access token returned here CAN read those videos. Note that
 * `GET /{page-id}?fields=access_token` directly is rejected without
 * `pages_read_engagement`, so we must enumerate via `/me/accounts`, which
 * returns page tokens for every Page the user has a role on.
 *
 * Never throws: failing to enumerate Pages must not break media that already
 * resolves with the user token. On error it returns an empty map, and
 * page-owned videos then fall through to the degraded UI (poster + permalink).
 */
export async function getManagedPageTokens(
  userAccessToken: string,
): Promise<Map<string, string>> {
  const pageTokens = new Map<string, string>();
  let after: string | undefined;

  try {
    // Defensive page cap: 10 pages × 100 = 1000 Pages is far beyond any real
    // advertiser; the cap just prevents an unbounded loop on odd paging.
    for (let i = 0; i < 10; i += 1) {
      const params = new URLSearchParams({
        fields: "id,access_token",
        limit: "100",
      });
      if (after) params.set("after", after);

      const res = await metaApiCall<GraphMeAccountsResponse>({
        domain: "FACEBOOK",
        method: "GET",
        path: "me/accounts",
        params: params.toString(),
        accessToken: userAccessToken,
      });

      for (const row of res.data ?? []) {
        if (row.id && row.access_token) {
          pageTokens.set(row.id, row.access_token);
        }
      }

      after = res.paging?.cursors?.after;
      if (!after || !res.paging?.next || (res.data?.length ?? 0) === 0) break;
    }
  } catch (err) {
    console.warn("Falha ao obter tokens de páginas (/me/accounts):", err);
  }

  return pageTokens;
}
