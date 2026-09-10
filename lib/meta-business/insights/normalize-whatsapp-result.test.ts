/**
 * The result of a click-to-WhatsApp ad set, and the bug it exposed.
 *
 * A legacy CTWA campaign is `OUTCOME_SALES` (objective is immutable on Meta), so
 * `resolveObjectiveResult` looks for purchase action types — which a conversation never
 * produces. Every such campaign therefore reported ZERO results, on real spend. New
 * campaigns are `OUTCOME_ENGAGEMENT` and hit the primary conversation map. The rows
 * below are the actual Graph response for ad set `120246606793290541` (R$ 302,82 spent,
 * 24 conversations at R$ 12,62), trimmed to the fields that matter.
 *
 * The fix reads Meta's own `cost_per_result.indicator`, which names the action type that IS the
 * result for that row — but ONLY when the objective map matched nothing, so no figure that is
 * already correct can move.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { normalizeInsightRow, type RawInsight } from "./normalize";

const currency = "BRL";

/** The live CTWA row, trimmed. Note: no purchase action of any kind. */
const ctwaRow = {
  spend: "302.82",
  actions: [
    { action_type: "link_click", value: "310" },
    { action_type: "post_engagement", value: "412" },
    {
      action_type: "onsite_conversion.messaging_conversation_started_7d",
      value: "24",
    },
    { action_type: "onsite_conversion.total_messaging_connection", value: "28" },
  ],
  cost_per_action_type: [
    {
      action_type: "onsite_conversion.messaging_conversation_started_7d",
      value: "12.6175",
    },
  ],
  cost_per_result: [
    {
      indicator: "actions:onsite_conversion.messaging_conversation_started_7d",
      values: [{ value: "12.6175", attribution_windows: ["default"] }],
    },
  ],
} as unknown as RawInsight;

test("a click-to-WhatsApp ad set reports conversations, not zero purchases", () => {
  const row = normalizeInsightRow(ctwaRow, {
    objective: "OUTCOME_SALES",
    currency,
  });

  assert.equal(row.result.count, 24);
  assert.equal(row.result.costPerResult, 12.62);
  assert.equal(
    row.result.actionType,
    "onsite_conversion.messaging_conversation_started_7d",
  );
  assert.equal(row.result.label, "Conversas iniciadas");
});

test("a WhatsApp result carries no monetary value and no ROAS", () => {
  const row = normalizeInsightRow(
    {
      ...ctwaRow,
      // An account that ALSO runs website sales can carry a purchase ROAS on the same row.
      // Attributing it to a count of conversations would invent a return the ad never made.
      purchase_roas: [{ action_type: "omni_purchase", value: "8.3" }],
    } as unknown as RawInsight,
    { objective: "OUTCOME_SALES", currency },
  );

  assert.equal(row.result.roas, null);
  assert.equal(row.result.value, null);
});

test("the indicator is used even before the first conversation arrives", () => {
  // Meta returns the indicator with no `values` while the ad set has produced nothing — which
  // is what lets the screen name the result correctly on day zero.
  const row = normalizeInsightRow(
    {
      spend: "18.13",
      actions: [{ action_type: "link_click", value: "9" }],
      cost_per_result: [
        {
          indicator:
            "actions:onsite_conversion.messaging_conversation_started_7d",
        },
      ],
    } as unknown as RawInsight,
    { objective: "OUTCOME_SALES", currency },
  );

  assert.equal(row.result.label, "Conversas iniciadas");
  assert.equal(row.result.count, null);
  assert.equal(row.result.costPerResult, null);
});

test("a website sales row is untouched by the fallback", () => {
  const row = normalizeInsightRow(
    {
      spend: "500",
      actions: [
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "12" },
      ],
      action_values: [
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "4150" },
      ],
      cost_per_action_type: [
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "41.67" },
      ],
      purchase_roas: [{ action_type: "omni_purchase", value: "8.3" }],
      // Present on every row — it must NOT override a map hit.
      cost_per_result: [
        {
          indicator: "actions:onsite_conversion.messaging_conversation_started_7d",
          values: [{ value: "999" }],
        },
      ],
    } as unknown as RawInsight,
    { objective: "OUTCOME_SALES", currency },
  );

  assert.equal(row.result.label, "Compras");
  assert.equal(row.result.count, 12);
  assert.equal(row.result.costPerResult, 41.67);
  assert.equal(row.result.value, 4150);
  assert.equal(row.result.roas, 8.3);
});

test("a new CTWA campaign on OUTCOME_ENGAGEMENT hits the primary conversation map", () => {
  const row = normalizeInsightRow(ctwaRow, {
    objective: "OUTCOME_ENGAGEMENT",
    currency,
  });

  assert.equal(row.result.count, 24);
  assert.equal(row.result.costPerResult, 12.62);
  assert.equal(
    row.result.actionType,
    "onsite_conversion.messaging_conversation_started_7d",
  );
  assert.equal(row.result.label, "Conversas iniciadas");
});

test("an engagement row is named after what was actually measured", () => {
  const boost = normalizeInsightRow(
    {
      spend: "40",
      actions: [{ action_type: "post_engagement", value: "300" }],
      cost_per_action_type: [
        { action_type: "post_engagement", value: "0.13" },
      ],
    } as unknown as RawInsight,
    { objective: "OUTCOME_ENGAGEMENT", currency },
  );
  assert.equal(boost.result.label, "Engajamento da publicação");

  const messaging = normalizeInsightRow(
    {
      spend: "40",
      actions: [
        {
          action_type: "onsite_conversion.messaging_conversation_started_7d",
          value: "6",
        },
      ],
    } as unknown as RawInsight,
    { objective: "OUTCOME_ENGAGEMENT", currency },
  );
  assert.equal(messaging.result.label, "Conversas iniciadas");
});

test("a row with neither a mapped action nor an indicator stays empty", () => {
  const row = normalizeInsightRow(
    { spend: "10", actions: [{ action_type: "link_click", value: "5" }] } as unknown as RawInsight,
    { objective: "OUTCOME_SALES", currency },
  );

  assert.equal(row.result.actionType, null);
  assert.equal(row.result.count, null);
  assert.equal(row.result.label, "Compras");
});
