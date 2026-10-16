import assert from "node:assert/strict";
import test from "node:test";
import type { CustomAudienceView } from "../lib/meta-business/marketing/audiences/types";
import { buildInstagramAudienceRule } from "../lib/meta-business/marketing/audiences/instagram";
import { buildWebsiteAudienceRule } from "../lib/meta-business/marketing/audiences/website";
import { audienceTypeLabel, resolveAudienceEditKind, audienceEstimateLabel, audienceStatusLabel } from "../app/(admin)/marketing/audiences/audience-kind";

const base: CustomAudienceView = {
  id: "aud-1", subtype: "CUSTOM", ruleSummary: "not_applicable",
  capabilities: { read: "available", include: "unknown", exclude: "unknown", editMetadata: "available", share: "unknown", editRule: "unknown", manageMembers: "unknown", delete: "unknown", lookalikeSource: "unknown" },
};

test("unknown or unavailable member capability stays metadata-only", () => {
  assert.equal(resolveAudienceEditKind(base), "metadata");
  assert.equal(resolveAudienceEditKind({ ...base, capabilities: { ...base.capabilities, manageMembers: "unavailable" } }), "metadata");
  assert.equal(audienceTypeLabel(base), "Lista de clientes");
});
test("proven member capability opens the customer editor", () => {
  assert.equal(resolveAudienceEditKind({ ...base, capabilities: { ...base.capabilities, manageMembers: "available" } }), "customer");
});
test("lookalike without a representable rule keeps metadata editing", () => {
  const audience = { ...base, subtype: "LOOKALIKE" };
  assert.equal(resolveAudienceEditKind(audience), "metadata");
  assert.equal(audienceTypeLabel(audience), "Semelhante");
});
test("representable rules select their lossless editor before customer capability", () => {
  const instagram = { ...base, capabilities: { ...base.capabilities, manageMembers: "available" as const }, rule: buildInstagramAudienceRule({ profileId: "ig-1", criterion: "saved", retentionDays: 63 }) };
  const website = { ...base, capabilities: { ...base.capabilities, manageMembers: "available" as const }, rule: buildWebsiteAudienceRule({ pixelId: "pixel-1", criterion: "url", url: "/precos", retentionDays: 30 }) };
  assert.equal(resolveAudienceEditKind(instagram), "instagram");
  assert.equal(audienceTypeLabel(instagram), "Instagram");
  assert.equal(resolveAudienceEditKind(website), "website");
  assert.equal(audienceTypeLabel(website), "Site");
});
test("compound and external rules keep metadata editing", () => {
  const rule = buildInstagramAudienceRule({ profileId: "ig-1", criterion: "all", retentionDays: 30 });
  assert.equal(resolveAudienceEditKind({ ...base, rule: { ...rule, exclusions: { operator: "or", rules: [] } } }), "metadata");
  assert.equal(resolveAudienceEditKind({ ...base, rule: { external: true } }), "metadata");
});
test("missing estimates and statuses use source fallbacks and delivery has priority", () => {
  assert.equal(audienceEstimateLabel(base), "—");
  assert.equal(audienceStatusLabel(base), "Não informado");
  assert.equal(audienceStatusLabel({ ...base, operationStatus: { description: "Processando" } }), "Processando");
  assert.equal(audienceStatusLabel({ ...base, operationStatus: { description: "Processando" }, deliveryStatus: { description: "Pronto" } }), "Pronto");
});
test("zero and bounded estimates remain visible in pt-BR", () => {
  assert.equal(audienceEstimateLabel({ ...base, approximateCountLowerBound: 0 }), "0");
  assert.equal(audienceEstimateLabel({ ...base, approximateCountUpperBound: 2000 }), "2.000");
  assert.equal(audienceEstimateLabel({ ...base, approximateCountLowerBound: 1000, approximateCountUpperBound: 2500 }), "1.000–2.500");
});
