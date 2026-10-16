import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { campaignBudgetMicros, formatCampaignBudgetInput, campaignBudgetReach } from "./whatsapp-campaign-budget";

describe("campaign BRL budget", () => {
  it("formats cents and parses BRL grouping without changing the saved amount", () => {
    assert.equal(formatCampaignBudgetInput("10000"), "R$\u00a0100,00");
    assert.equal(formatCampaignBudgetInput("R$ 1.234,56"), "R$\u00a01.234,56");
    assert.equal(campaignBudgetMicros("R$ 1.234,56"), 1_234_560_000);
    assert.equal(campaignBudgetMicros(formatCampaignBudgetInput("1")), 10_000);
    assert.equal(formatCampaignBudgetInput(""), "");
    assert.equal(campaignBudgetMicros(""), 0);
  });
  it("rounds affordable recipients down and handles unavailable pricing", () => {
    assert.equal(campaignBudgetReach(100_000_000,321_700),310);
    assert.equal(campaignBudgetReach(321_700,321_700),1);
    assert.equal(campaignBudgetReach(321_699,321_700),0);
    assert.equal(campaignBudgetReach(0,321_700),0);
    assert.equal(campaignBudgetReach(100_000_000),null);
    assert.equal(campaignBudgetReach(100_000_000,0),null);
  });
});
