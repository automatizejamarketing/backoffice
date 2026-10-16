// Run with bun from backoffice root. No browser, server, DB or network required.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseInstagramAudienceRule } from "../../../../../../lib/meta-business/marketing/audiences/instagram.ts";
import { parseWebsiteAudienceRule } from "../../../../../../lib/meta-business/marketing/audiences/website.ts";
import { assessLookalikeSource } from "../../../../../../lib/meta-business/marketing/audiences/lookalike.ts";

const ownDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(ownDir, "audiences.init.js"), "utf8");
let nativeCalls = 0;
const context = vm.createContext({
  URL, URLSearchParams, Response, Request, Blob, FormData, setTimeout,
  location: { href: "http://localhost:3016/marketing/audiences?userId=fixture-user&accountId=111", origin: "http://localhost:3016" },
  fetch: async () => { nativeCalls += 1; throw new Error("NETWORK MUST NOT RUN"); },
});
context.window = context;
vm.runInContext(source, context);
const url = (suffix = "audiences", a = "111") => `/api/meta-marketing/${a}/${suffix}?userId=fixture-user`;
const send = async (suffix, body, a = "111") => context.fetch(url(suffix, a), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const body = async (response) => { assert.equal(response.status, 200); return response.json(); };
let checks = 0;
async function check(name, run) { await run(); checks += 1; process.stdout.write(`PASS ${name}\n`); }

await check("isolated account catalogs and deterministic pagination", async () => {
  const page1 = await body(await context.fetch(url()));
  assert.equal(page1.audiences.length, 6);
  assert.equal(page1.nextCursor, "fixture-111-page2");
  const page2 = await body(await context.fetch(`${url()}&after=${page1.nextCursor}`));
  assert.equal(page2.audiences.length, 2);
  assert.equal(page2.hasNextPage, false);
  const other = await body(await context.fetch(url("audiences", "222")));
  assert.ok(other.audiences.every((a) => a.id.startsWith("aud222-")));
  assert.equal((await context.fetch(`${url("audiences", "222")}&after=fixture-111-page2`)).status, 400);
});
await check("real rule parsers resolve editable rules and preserve compound rules", async () => {
  const catalog = (await body(await context.fetch(url()))).audiences;
  assert.equal(parseInstagramAudienceRule(catalog[1].rule)?.criterion, "engaged");
  assert.equal(parseWebsiteAudienceRule(catalog[2].rule)?.criterion, "visitors");
  assert.equal(parseWebsiteAudienceRule(catalog[4].rule), null);
});
await check("real lookalike assessment accepts seed and blocks pending imports/lookalikes", async () => {
  const catalog = (await body(await context.fetch(url()))).audiences;
  assert.equal(assessLookalikeSource(catalog[0]).ok, true);
  assert.equal(assessLookalikeSource(catalog[3]).ok, false);
  assert.equal(assessLookalikeSource(catalog[5]).ok, false);
});
await check("source catalogs include source-specific periods and all Instagram activities", async () => {
  const ig = await body(await context.fetch(`${url()}&sources=instagram`));
  assert.deepEqual(Object.keys(ig.periodEvidenceByProfile.ig111), ["all", "engaged", "profile_visit", "messaged", "saved"]);
  assert.equal(ig.periodEvidenceByProfile.ig111.saved.metaMaximumDays, 365);
  const web = await body(await context.fetch(`${url()}&sources=website`));
  assert.equal(web.sources[0].source.observedEventsStatus, "available");
  assert.deepEqual(web.sources[1].source.observedEvents, []);
  assert.equal(web.periodEvidence.pixel111.event.metaMaximumDays, 180);
});
await check("MarketingWorkspace connection/accounts/panel read contracts enable account222 entry", async () => {
  const userApi = "/api/users/fixture-user";
  const connection = await body(await context.fetch(`${userApi}/meta-account`));
  assert.equal(connection.userId, "fixture-user");
  assert.equal(connection.connectionStatus, "active");
  assert.equal(Object.hasOwn(connection, "accessToken"), false);
  const assetCard = await body(await context.fetch(`${userApi}/meta-assets`));
  assert.equal(assetCard.canEdit, false);
  assert.equal(assetCard.granted.adAccounts[1].id, "act_222");
  assert.equal(assetCard.enabled.adAccounts[1].available, true);
  assert.equal((await body(await context.fetch(`${userApi}/meta-account/partner-access`))).status, "complete");
  assert.deepEqual((await body(await context.fetch(`${userApi}/meta-account/publish-holds`))).holds, []);
  assert.deepEqual((await body(await context.fetch(`${userApi}/playbook-insights`))).insights, []);
  assert.deepEqual((await body(await context.fetch(`${userApi}/client-reports`))).snapshots, []);
  const money = await body(await context.fetch(`${userApi}/ad-accounts/act_222/money?fresh=1`));
  assert.equal(money.adAccountId, "222");
  assert.equal(money.money.kind, "owed");
  assert.equal(money.connectionKind, "user");
  assert.deepEqual((await body(await context.fetch(`${url("campaigns", "222")}&effectiveStatus=ACTIVE&fetchAll=1`))).data, []);
  assert.equal((await context.fetch(`${userApi}/ad-accounts/999/money`)).status, 501);
  assert.equal((await context.fetch(`${userApi}/meta-account/admin-reconnect`, { method: "POST" })).status, 403);
  assert.equal((await context.fetch(`${userApi}/meta-assets/selection`, { method: "POST" })).status, 403);
  assert.equal(nativeCalls, 0);
});
await check("wrong user/account/method/action fail closed", async () => {
  for (const request of [
    ["/api/meta-marketing", {}],
    ["/api/users", {}],
    ["/api/meta-marketing/111/audiences?userId=real-user", {}],
    ["/api/meta-marketing/999/audiences?userId=fixture-user", {}],
    ["/api/meta-marketing/111/audiences?userId=fixture-user", { method: "DELETE" }],
    ["/api/users/real-user/ad-accounts", {}],
    ["/api/users/fixture-user/ad-accounts", { method: "POST" }],
    ["/api/meta-marketing/111/pixels?userId=fixture-user", { method: "POST", body: "{}" }],
    ["https://graph.facebook.com/v25.0/act_111/customaudiences", { method: "POST" }],
    ["/api/upload", { method: "POST" }],
  ]) assert.ok((await context.fetch(...request)).status >= 400);
  assert.equal((await send("audiences", { action: "uncovered" })).status, 501);
  assert.equal(nativeCalls, 0);
});
await check("metadata review carries full impact and confirmation updates local catalog", async () => {
  const change = { audienceId: "aud111-external", name: "Metadados revisados" };
  const review = await body(await send("audiences", { action: "review", ...change }));
  assert.ok(Array.isArray(review.impact.dependentAudienceIds));
  assert.equal(review.impact.coverage, "complete");
  assert.equal(review.impact.knownUses[0].placement, "include");
  const confirmation = { action: "confirm", ...change, confirmationToken: review.confirmationToken, commandId: review.commandId };
  assert.equal((await send("audiences", { ...confirmation, name: "Changed after review" })).status, 409);
  assert.equal((await send("audiences", confirmation, "222")).status, 404);
  await body(await send("audiences", confirmation));
  const item = context.__audienceFixture.inspect().library["111"].find((a) => a.id === change.audienceId);
  assert.equal(item.name, change.name);
  assert.equal(parseWebsiteAudienceRule(item.rule), null);
});
await check("Instagram, website and lookalike creation review/confirm stays local", async () => {
  for (const [kind, selection] of [
    ["instagram", { profileId: "ig111", criterion: "messaged", retentionDays: 100 }],
    ["website", { pixelId: "pixel111", criterion: "event", retentionDays: 30, event: "Purchase" }],
    ["lookalike", { originAudienceId: "aud111-customer", country: "BR", percentage: 1 }],
  ]) {
    const data = { name: `Created ${kind}`, ...selection };
    const review = await body(await send("audiences", { action: `${kind}-review`, ...data }));
    const saved = await body(await send("audiences", { action: `${kind}-confirm`, ...data, confirmationToken: review.confirmationToken, commandId: review.commandId }));
    assert.ok(saved.audienceId.startsWith("aud111-created-"));
  }
});
await check("uncertain confirmation and reconciliation retain reviewed payload", async () => {
  context.__audienceFixture.configure({ scenario: "reconcile" });
  const data = { audienceId: "aud111-unknown", name: "Reconciled metadata" };
  const review = await body(await send("audiences", { action: "review", ...data }));
  const request = { ...data, confirmationToken: review.confirmationToken, commandId: review.commandId };
  const uncertain = await send("audiences", { action: "confirm", ...request });
  assert.equal(uncertain.status, 409);
  assert.equal((await uncertain.json()).state, "reconciliation_required");
  await body(await send("audiences", { action: "reconcile", ...request }));
  context.__audienceFixture.configure({ scenario: "default" });
});
await check("deletion preflight, dependency rejection and confirm remove local object", async () => {
  assert.equal((await send("audiences", { action: "delete-review", audienceId: "aud111-customer" })).status, 409);
  const review = await body(await send("audiences", { action: "delete-review", audienceId: "aud111-unknown" }));
  assert.ok(Array.isArray(review.preflight.lookalikeAudienceIds));
  await body(await send("audiences", { action: "delete-confirm", audienceId: "aud111-unknown", confirmationToken: review.preflight.confirmationToken }));
  assert.equal(context.__audienceFixture.inspect().library["111"].some((a) => a.id === "aud111-unknown"), false);
});
await check("customer upload/preview/declarations/terms/start/history have accurate shapes", async () => {
  context.__audienceFixture.configure({ scenario: "terms-pending" });
  const form = new FormData();
  form.set("file", new Blob(["email,phone\na@example.test,+551199990001"]), "customers.csv");
  form.set("operation", "create"); form.set("name", "New synthetic list");
  const upload = await body(await context.fetch(url("audiences/customer-file"), { method: "POST", body: form }));
  assert.equal(upload.limits.maxBytes, 20 * 1024 * 1024);
  const endpoint = `audiences/customer-file/${upload.operationId}`;
  let preview = await body(await send(endpoint, { action: "preview", emailColumn: "email" }));
  assert.equal(preview.declarations.termsAccepted, false);
  assert.equal(preview.confirmation.requiresValidRowsChoice, true);
  assert.equal((await send(endpoint, { action: "start", previewToken: preview.previewToken })).status, 409);
  await body(await context.fetch(url("audiences/customer-file/terms"), { method: "POST" }));
  preview = await body(await send(endpoint, { action: "preview", emailColumn: "email" }));
  const finished = await body(await send(endpoint, { action: "start", previewToken: preview.previewToken, explicitlySendValidRows: true, declarations: { dataOrigin: preview.declarations.dataOrigin, termsAccepted: true } }));
  assert.equal(finished.phase, "completed");
  assert.equal((await body(await context.fetch(url("audiences/customer-file")))).operations[0].operationId, upload.operationId);
  context.__audienceFixture.configure({ scenario: "default" });
});
await check("Request objects and act_ account IDs supported", async () => {
  const request = new Request(`http://localhost:3016${url("audiences", "act_222")}`);
  const response = await context.fetch(request);
  assert.equal(response.status, 200);
});
await check("AI scan/plan/copy canned locally; publication and uploads rejected", async () => {
  const scan = await body(await send("campaigns/ai/scan", { objective: "sales" }));
  assert.equal(scan.mold.metrics.roas, 8);
  assert.equal(scan.provenAds[0].isDynamicCreative, false);
  const plan = await body(await send("campaigns/ai/plan", { mold: scan.mold, answers: { dailyBudget: 50, medias: [{ kind: "instagram_post", instagramMediaId: "media111" }] } }));
  assert.equal(plan.review.budget.dailyCents, 5000);
  assert.equal(plan.review.audience.customAudiences, 1);
  assert.deepEqual(plan.review.audience.includedCustomAudienceIds, ["aud111-customer"]);
  assert.equal(plan.review.audience.adSets[0].index, 0);
  assert.equal(plan.review.audience.adSets[0].ageSource, "inherited");
  assert.equal(plan.review.audience.adSets[0].customAudiences, 1);
  const limited = await body(await send("campaigns/ai/plan", { mold: scan.mold, answers: { demographics: { age: { min: 25, max: 40 }, genders: [2] }, includedCustomAudienceIds: [], excludedCustomAudienceIds: [] } }));
  assert.equal(limited.review.audience.ageMin, 25);
  assert.equal(limited.review.audience.ageMax, 40);
  assert.deepEqual(limited.review.audience.genders, [2]);
  assert.equal(limited.review.audience.customAudiences, 0);
  assert.equal(limited.review.audience.excludedCustomAudiences, 0);
  assert.equal(limited.review.audience.adSets[0].ageSource, "applied");
  assert.equal(limited.review.audience.adSets[0].genderSource, "applied");
  assert.equal((await send("campaigns/ai/create", {})).status, 403);
  assert.equal((await send("campaigns/ai/fallback", {})).status, 403);
  assert.equal((await send("campaigns/ai/video", {})).status, 403);
  assert.equal((await body(await send("campaigns/ai/copy", {}))).headline, "Título sintético");
  assert.equal(nativeCalls, 0);
});
process.stdout.write(`${checks} checks passed; ${nativeCalls} native fetch calls.\n`);
