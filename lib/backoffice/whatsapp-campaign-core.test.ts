import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertSchedule, campaignInput, campaignPhone } from "./whatsapp-campaign-core";
import { OCTOBER_WHATSAPP_TEMPLATES } from "./whatsapp-october-templates";

describe("WhatsApp campaign validation", () => {
  const valid = { scheduledAt: new Date("2026-10-08T15:00:00Z"), now: new Date("2026-10-05T15:00:00Z"), count: 664, unitCostMicros: 300_000, budgetMicros: 199_200_000, templateStatus: "APPROVED", templateBody: "Olá", body: "Olá" };
  it("enforces budget at the boundary and requires an approved unchanged body", () => {
    assert.doesNotThrow(() => assertSchedule(valid));
    assert.throws(() => assertSchedule({ ...valid, budgetMicros: valid.budgetMicros - 1 }));
    assert.throws(() => assertSchedule({ ...valid, unitCostMicros: 0 }));
    assert.throws(() => assertSchedule({ ...valid, templateStatus: "PENDING" }));
    assert.throws(() => assertSchedule({ ...valid, body: "Alterado" }));
    assert.throws(() => assertSchedule({ ...valid, count: 0 }));
    assert.throws(() => assertSchedule({ ...valid, scheduledAt: valid.now }));
  });
  it("canonicalizes phones before deduplication and rejects malformed numbers", () => {
    assert.equal(campaignPhone("(22) 99725-9506"), campaignPhone("+55 22 99725-9506"));
    for (const phone of [null, "123", "00123456789", "+1 212 555 1234"]) assert.equal(campaignPhone(phone), null);
  });
  it("rejects unresolved placeholders and unsupported variables", () => {
    const input = { title: "Teste", templateName: "teste_v1", body: "Olá {{1}}", unitCostMicros: 0, budgetMicros: 0 };
    assert.equal(campaignInput.safeParse(input).success, true);
    for (const body of ["Olá [LINK_TRIAL]", "Olá {{2}}", "[NOME]", "a".repeat(1025)]) assert.equal(campaignInput.safeParse({ ...input, body }).success, false);
    for (const seed of OCTOBER_WHATSAPP_TEMPLATES) assert.equal(campaignInput.safeParse({ ...input, title: seed.title, templateName: seed.name, body: seed.body }).success, true);
  });
});
