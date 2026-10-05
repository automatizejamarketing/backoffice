import assert from "node:assert/strict";
import test from "node:test";
import { resolveAudienceAccountId, buildAudienceLibraryHref } from "../app/(admin)/marketing/audiences/audience-account-selection";

const accounts = [{ id: "act_111", account_id: "111" }, { id: "act_222", account_id: "222" }];
test("explicit second account is preserved", () => assert.equal(resolveAudienceAccountId(accounts, "222"), "222"));
test("Meta prefix represents the same accessible account", () => assert.equal(resolveAudienceAccountId(accounts, "act_222"), "222"));
test("inaccessible requested account never falls back silently", () => assert.equal(resolveAudienceAccountId(accounts, "999"), null));
test("absent request keeps the first-account default", () => assert.equal(resolveAudienceAccountId(accounts, null), "111"));
test("empty list has no default", () => assert.equal(resolveAudienceAccountId([], null), null));
test("malformed explicit requests never become the default", () => {
  for (const requested of ["", " ", "act_", "act_act_222", "222x", "222/", " 222", "-222"]) {
    assert.equal(resolveAudienceAccountId(accounts, requested), null, requested);
  }
});
test("prefixed accessible account values resolve to their canonical digits", () => {
  assert.equal(resolveAudienceAccountId([{ id: "act_222", account_id: "act_222" }], "222"), "222");
  assert.equal(resolveAudienceAccountId([{ account_id: "act_222" }], null), "222");
});
test("malformed accessible values cannot authorize an account", () => {
  assert.equal(resolveAudienceAccountId([{ account_id: "invalid", id: "act_222" }], "222"), null);
  assert.equal(resolveAudienceAccountId([{ account_id: "" }], null), null);
});
test("embed link carries both boundaries and encodes parameters", () => {
  const url = new URL(buildAudienceLibraryHref({ userId: "client & 1", accountId: "222", embedded: true }), "http://localhost");
  assert.equal(url.pathname, "/embed/marketing/audiences");
  assert.equal(url.searchParams.get("userId"), "client & 1");
  assert.equal(url.searchParams.get("accountId"), "222");
});
test("ordinary link omits an absent account and encodes the client", () => {
  assert.equal(buildAudienceLibraryHref({ userId: "client & 1", accountId: null }), "/marketing/audiences?userId=client+%26+1");
});
