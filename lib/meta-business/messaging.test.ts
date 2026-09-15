/**
 * What makes a campaign "de conversa", and what its rows read as.
 *
 * The rows below follow the shape of the live click-to-WhatsApp response in
 * `lib/meta-business/insights/normalize-whatsapp-result.test.ts`: an
 * OUTCOME_SALES campaign whose only results are conversations.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  isMessagingAdSet,
  isMessagingAdSetConfig,
  isMessagingCampaign,
  messagingInsightMetrics,
} from "@/lib/meta-business/messaging";
import type { GraphApiInsights } from "@/lib/meta-business/types";

const ctwaRow: GraphApiInsights = {
  spend: "302.82",
  actions: [
    { action_type: "link_click", value: "310" },
    { action_type: "post_engagement", value: "412" },
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
    { action_type: "onsite_conversion.messaging_first_reply", value: "15.94" },
  ],
  cost_per_result: [
    {
      indicator: "actions:onsite_conversion.messaging_conversation_started_7d",
      values: [{ value: "12.6175", attribution_windows: ["default"] }],
    },
  ],
};

const websiteRow: GraphApiInsights = {
  spend: "120.00",
  actions: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "3" }],
  cost_per_result: [
    {
      indicator: "actions:offsite_conversion.fb_pixel_purchase",
      values: [{ value: "40" }],
    },
  ],
};

test("an ad set is messaging only with the conversations goal and a messaging destination", () => {
  assert.equal(
    isMessagingAdSetConfig({
      optimization_goal: "CONVERSATIONS",
      destination_type: "WHATSAPP",
    }),
    true,
  );
  assert.equal(
    isMessagingAdSetConfig({
      optimization_goal: "CONVERSATIONS",
      destination_type: "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP",
    }),
    true,
  );
  assert.equal(isMessagingAdSetConfig({ optimization_goal: "CONVERSATIONS" }), false);
  assert.equal(isMessagingAdSetConfig({ destination_type: "WHATSAPP" }), false);
  assert.equal(
    isMessagingAdSetConfig({
      optimization_goal: "MESSAGING_PURCHASE_CONVERSION",
      destination_type: "WHATSAPP",
    }),
    false,
  );
  assert.equal(
    isMessagingAdSetConfig({
      optimization_goal: "OFFSITE_CONVERSIONS",
      destination_type: "WEBSITE",
    }),
    false,
  );
  assert.equal(isMessagingAdSetConfig({}), false);
  assert.equal(isMessagingAdSetConfig(undefined), false);
});

test("a legacy MESSAGES campaign is messaging by objective alone", () => {
  assert.equal(isMessagingCampaign({ objective: "MESSAGES" }), true);
  assert.equal(isMessagingCampaign({ objective: "messages" }), true);
});

test("an ODAX sales campaign is messaging when any ad set delivers to WhatsApp", () => {
  assert.equal(
    isMessagingCampaign({
      objective: "OUTCOME_SALES",
      adSets: [
        { optimization_goal: "OFFSITE_CONVERSIONS", destination_type: "WEBSITE" },
        { optimization_goal: "CONVERSATIONS", destination_type: "WHATSAPP" },
      ],
    }),
    true,
  );
});

test("an ODAX objective alone never classifies a campaign as messaging", () => {
  assert.equal(isMessagingCampaign({ objective: "OUTCOME_SALES" }), false);
  assert.equal(isMessagingCampaign({ objective: "OUTCOME_ENGAGEMENT" }), false);
  assert.equal(
    isMessagingCampaign({
      objective: "OUTCOME_LEADS",
      adSets: [{ destination_type: "WHATSAPP" }],
    }),
    false,
  );
});

test("an ad set row is classified only from its own configuration", () => {
  assert.equal(
    isMessagingAdSet({
      optimization_goal: "CONVERSATIONS",
      destination_type: "WHATSAPP",
    }),
    true,
  );
  assert.equal(
    isMessagingAdSet({
      optimization_goal: "OFFSITE_CONVERSIONS",
      destination_type: "WHATSAPP",
    }),
    false,
  );
});

test("the messaging metrics come off actions and cost_per_action_type", () => {
  assert.deepEqual(messagingInsightMetrics(ctwaRow), {
    messagingConversationCount: "24",
    messagingConversationCost: "12.6175",
    messagingNewContactCount: "19",
    messagingNewContactCost: "15.94",
    messagingBlockedCount: "1",
    messagingSubscriptionCount: "7",
  });
});

test("a row with no messaging activity reports nothing, not zero", () => {
  assert.deepEqual(messagingInsightMetrics(websiteRow), {
    messagingConversationCount: undefined,
    messagingConversationCost: undefined,
    messagingNewContactCount: undefined,
    messagingNewContactCost: undefined,
    messagingBlockedCount: undefined,
    messagingSubscriptionCount: undefined,
  });
});
