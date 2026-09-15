/**
 * The messaging extra metrics Mat can ask for. They are not Graph fields, so
 * two things must hold: the whitelist accepts them but keeps them OUT of
 * `fields=`, and the normalizer reads them off the action families.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  MESSAGING_METRIC_FIELDS,
  graphFieldsFor,
  validateExtraMetrics,
} from "./catalogs/metrics";
import { normalizeInsightRow, specsForFields, type RawInsight } from "./normalize";

const ctwaRow = {
  spend: "302.82",
  actions: [
    {
      action_type: "onsite_conversion.messaging_conversation_started_7d",
      value: "24",
    },
    { action_type: "onsite_conversion.messaging_first_reply", value: "19" },
    { action_type: "onsite_conversion.messaging_block", value: "1" },
    {
      action_type: "onsite_conversion.messaging_user_subscribed",
      value: "7",
    },
  ],
  cost_per_action_type: [
    {
      action_type: "onsite_conversion.messaging_conversation_started_7d",
      value: "12.6175",
    },
    { action_type: "onsite_conversion.messaging_first_reply", value: "15.937" },
  ],
} as unknown as RawInsight;

test("messaging metrics pass the whitelist but never reach fields=", () => {
  assert.deepEqual(MESSAGING_METRIC_FIELDS, [
    "messaging_conversations_started",
    "cost_per_messaging_conversation_started",
    "messaging_new_contacts",
    "cost_per_messaging_new_contact",
    "messaging_blocked",
    "messaging_subscriptions",
  ]);

  const { valid, rejected } = validateExtraMetrics([
    ...MESSAGING_METRIC_FIELDS,
    "inline_link_clicks",
    "not_a_metric",
  ]);

  assert.deepEqual(rejected, ["not_a_metric"]);
  assert.deepEqual(valid, [...MESSAGING_METRIC_FIELDS, "inline_link_clicks"]);
  assert.deepEqual(graphFieldsFor(valid), ["inline_link_clicks"]);
});

test("messaging extras are read off actions / cost_per_action_type", () => {
  const row = normalizeInsightRow(ctwaRow, {
    objective: "OUTCOME_ENGAGEMENT",
    extraSpecs: specsForFields(MESSAGING_METRIC_FIELDS),
    currency: "BRL",
  });

  assert.deepEqual(row.extras, {
    messaging_conversations_started: 24,
    cost_per_messaging_conversation_started: 12.62,
    messaging_new_contacts: 19,
    cost_per_messaging_new_contact: 15.94,
    messaging_blocked: 1,
    messaging_subscriptions: 7,
  });
});

test("a row without messaging activity answers null, not zero", () => {
  const row = normalizeInsightRow(
    { spend: "10", actions: [{ action_type: "link_click", value: "3" }] } as unknown as RawInsight,
    {
      objective: "OUTCOME_TRAFFIC",
      extraSpecs: specsForFields(["messaging_conversations_started"]),
      currency: "BRL",
    },
  );

  assert.deepEqual(row.extras, { messaging_conversations_started: null });
});
