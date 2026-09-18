import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath: string) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

/**
 * The identities a client can advertise with are NOT the pages their personal Facebook account
 * manages (`me/accounts`): a page shared through the Business Manager only shows up under the ad
 * account's `promote_pages` or the BISU's `assigned_pages`. The frontend lists them through
 * `getAdvertisingIdentities` (Ads Manager semantics) and so must every backoffice surface that
 * shows, validates or lets the operator pick an identity — otherwise the client sees two pages
 * in the app and the backoffice sees one.
 */
describe("identities are listed with Ads Manager semantics", () => {
  test("the pages route lists identities promotable under the requested ad account", () => {
    const route = readSource("app/api/meta-marketing/[accountId]/pages/route.ts");

    assert.match(
      route,
      /import \{ getAdvertisingIdentities \} from "@\/lib\/meta-business\/get-instagram-connected-page"/,
    );
    assert.match(route, /getAdvertisingIdentities\(tokenResult\.accessToken, \{/);
    assert.match(route, /adAccountId: accountId/);
    assert.match(route, /tokenKind: tokenResult\.connection\.tokenKind/);
    assert.match(route, /bisuAppScopedId: tokenResult\.connection\.bisuAppScopedId/);
    assert.doesNotMatch(route, /getPagesWithInstagram\b/);
  });

  test("the Instagram media route resolves the requested account under the ad account, never falling back to me/accounts", () => {
    const route = readSource("app/api/meta-marketing/[accountId]/instagram/user-media/route.ts");

    assert.match(
      route,
      /import \{ getPagesWithInstagramAccounts \} from "@\/lib\/meta-business\/get-instagram-connected-page"/,
    );
    assert.match(route, /getPagesWithInstagramAccounts\(accessToken, \{/);
    assert.match(route, /adAccountId: accountId/);
    assert.match(route, /tokenKind: tokenResult\.connection\.tokenKind/);
    assert.match(route, /bisuAppScopedId: tokenResult\.connection\.bisuAppScopedId/);
    assert.doesNotMatch(route, /path: "me\/accounts"/);
    // A requested identity that is not listed is an error, not a silent switch to another
    // profile's posts.
    assert.doesNotMatch(route, /requestedPage\?\.instagram_business_account \?\? pagesWithInstagram\[0\]/);
  });

  test("the hub card and Definir seleção grant identities across every granted ad account", () => {
    for (const relativePath of [
      "lib/backoffice/meta-assets-card-data.ts",
      "lib/backoffice/meta-asset-mutations.ts",
    ]) {
      const source = readSource(relativePath);
      assert.match(
        source,
        /import \{ getAdvertisingIdentities \} from "@\/lib\/meta-business\/get-instagram-connected-page"/,
        relativePath,
      );
      assert.match(source, /getAdvertisingIdentities\(token\.accessToken, \{/, relativePath);
      assert.match(source, /adAccountIds:/, relativePath);
      assert.match(source, /tokenKind: token\.connection\.tokenKind/, relativePath);
      assert.match(source, /bisuAppScopedId: token\.connection\.bisuAppScopedId/, relativePath);
      assert.doesNotMatch(source, /getPagesWithInstagram\b/, relativePath);
    }
  });
});
