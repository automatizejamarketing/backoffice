import type { GraphApiInsights, InsightsMetrics } from "@/lib/meta-business/types";

/**
 * Messaging ("conversa") campaigns — ads that send people to WhatsApp, Messenger
 * or Instagram Direct — in the vocabulary of the Marketing API v25.0, and how to
 * read their results.
 *
 * Under ODAX "conversations" is not an objective. The campaign is
 * `OUTCOME_ENGAGEMENT`, `OUTCOME_SALES` or `OUTCOME_LEADS` ("Vendas via
 * mensagem" is the common case in Brazil) and what makes it a messaging campaign
 * lives on the AD SET: `optimization_goal` and `destination_type`. Only the
 * legacy `MESSAGES` objective says it at campaign level. Reading the objective
 * alone would therefore show purchase columns on a WhatsApp campaign — which is
 * exactly what this module exists to prevent.
 *
 * Every action type here is documented in the v25.0 Ads Action Stats reference.
 * Ads Manager shows more (replies, conversation depth, welcome-message views);
 * those do not appear in the reference and are left out on purpose.
 */

/** The v25.0 optimization goal that makes the optimized result a conversation. */
export const MESSAGING_OPTIMIZATION_GOAL = "CONVERSATIONS";

/**
 * Ad set `destination_type` values that land in a messaging app
 * (Ad Set reference v25.0), including the multi-app combinations.
 */
export const MESSAGING_DESTINATION_TYPES: ReadonlySet<string> = new Set([
  "MESSENGER",
  "WHATSAPP",
  "INSTAGRAM_DIRECT",
  "MESSAGING_MESSENGER_WHATSAPP",
  "MESSAGING_INSTAGRAM_DIRECT_MESSENGER",
  "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP",
  "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP",
]);

/** "Messaging Conversations Started" — Ads Manager's "Conversas por mensagem iniciadas". */
export const MESSAGING_CONVERSATION_STARTED_ACTION_TYPE =
  "onsite_conversion.messaging_conversation_started_7d";

/** "New Messaging Conversations" — Ads Manager's "Novos contatos por mensagem". */
export const MESSAGING_FIRST_REPLY_ACTION_TYPE =
  "onsite_conversion.messaging_first_reply";

/** "Blocked Messaging Conversations" — Ads Manager's "Conexões por mensagem bloqueadas". */
export const MESSAGING_BLOCK_ACTION_TYPE = "onsite_conversion.messaging_block";

/** "Messaging Subscriptions" — Ads Manager's "Inscrições por mensagem". */
export const MESSAGING_SUBSCRIPTION_ACTION_TYPE =
  "onsite_conversion.messaging_user_subscribed";

/** The two ad set fields that mark a messaging destination, as Graph names them. */
export type MessagingAdSetMarkers = {
  optimization_goal?: string;
  destination_type?: string;
};

/**
 * Whether an ad set is configured to optimize conversations in a messaging app.
 *
 * Both markers are required. `destination_type` alone only says where the click
 * lands; an ad set may send people to WhatsApp while optimizing a purchase or a
 * lead instead of a conversation.
 */
export function isMessagingAdSetConfig(
  adSet: MessagingAdSetMarkers | undefined,
): boolean {
  if (!adSet) return false;
  return (
    adSet.optimization_goal === MESSAGING_OPTIMIZATION_GOAL &&
    MESSAGING_DESTINATION_TYPES.has(adSet.destination_type ?? "")
  );
}

/**
 * The hybrid campaign-level rule: the legacy `MESSAGES` objective says it
 * outright; otherwise any ad set configured for conversations in a messaging
 * destination makes the campaign one.
 *
 * "Any ad set" on purpose: a campaign mixing a WhatsApp ad set with a website
 * one is producing conversations, and hiding them behind purchase columns is
 * the complaint that motivated this. The ad set rows themselves are classified
 * one by one (`isMessagingAdSet`), so the mix stays visible a level down.
 */
export function isMessagingCampaign(args: {
  objective?: string;
  adSets?: readonly MessagingAdSetMarkers[];
}): boolean {
  if (args.objective?.toUpperCase() === "MESSAGES") return true;
  return args.adSets?.some((adSet) => isMessagingAdSetConfig(adSet)) ?? false;
}

/** The ad set rule: both of its configuration markers must match. */
export function isMessagingAdSet(adSet: MessagingAdSetMarkers): boolean {
  return isMessagingAdSetConfig(adSet);
}

type ActionStats = Array<{ action_type?: string; value?: string }> | undefined;

function actionValue(
  stats: ActionStats,
  actionType: string,
): string | undefined {
  return stats?.find((entry) => entry.action_type === actionType)?.value;
}

/** The subset of `InsightsMetrics` this module owns. */
export type MessagingInsightMetrics = Pick<
  InsightsMetrics,
  | "messagingConversationCount"
  | "messagingConversationCost"
  | "messagingNewContactCount"
  | "messagingNewContactCost"
  | "messagingBlockedCount"
  | "messagingSubscriptionCount"
>;

/**
 * The messaging metrics of one insights row. Counts come from `actions`, costs
 * from `cost_per_action_type` — both already part of every marketing insights
 * read (`MARKETING_INSIGHTS_METRIC_FIELDS`), so no extra Graph field is needed.
 * `undefined` means Meta did not report it, which the UI renders as "-".
 */
export function messagingInsightMetrics(
  data: GraphApiInsights,
): MessagingInsightMetrics {
  return {
    messagingConversationCount: actionValue(
      data.actions,
      MESSAGING_CONVERSATION_STARTED_ACTION_TYPE,
    ),
    messagingConversationCost: actionValue(
      data.cost_per_action_type,
      MESSAGING_CONVERSATION_STARTED_ACTION_TYPE,
    ),
    messagingNewContactCount: actionValue(
      data.actions,
      MESSAGING_FIRST_REPLY_ACTION_TYPE,
    ),
    messagingNewContactCost: actionValue(
      data.cost_per_action_type,
      MESSAGING_FIRST_REPLY_ACTION_TYPE,
    ),
    messagingBlockedCount: actionValue(data.actions, MESSAGING_BLOCK_ACTION_TYPE),
    messagingSubscriptionCount: actionValue(
      data.actions,
      MESSAGING_SUBSCRIPTION_ACTION_TYPE,
    ),
  };
}
