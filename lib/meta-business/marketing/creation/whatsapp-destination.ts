/**
 * Click-to-WhatsApp (CTWA): the exact fields Meta wants, in one place.
 *
 * Campaign objective is `OUTCOME_ENGAGEMENT`. Two Meta references disagree about which
 * objectives accept a WhatsApp destination, and Engagement is the one they BOTH accept:
 *
 * - https://developers.facebook.com/docs/marketing-api/ad-creative/messaging-ads/click-to-whatsapp/
 *   lists OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES and OUTCOME_TRAFFIC, and uses
 *   OUTCOME_ENGAGEMENT in its own example.
 * - https://developers.facebook.com/docs/marketing-api/adset/destination_type/ lists WHATSAPP
 *   under ENGAGEMENT / TRAFFIC / AWARENESS. For OUTCOME_SALES it lists only WEBSITE,
 *   MESSENGER and PHONE_CALL — so the earlier OUTCOME_SALES shape, though it ran live,
 *   contradicts that table. See ADR 0032.
 *
 *   campanha  objective:         OUTCOME_ENGAGEMENT
 *   ad set    destination_type:  WHATSAPP
 *             optimization_goal: CONVERSATIONS
 *             promoted_object:   { page_id }        ← sem whatsapp_phone_number
 *   criativo  link:              https://api.whatsapp.com/send
 *             call_to_action:    WHATSAPP_MESSAGE + value.app_destination = WHATSAPP
 *
 * `whatsapp_phone_number` is OPTIONAL and is deliberately not sent: Meta resolves the
 * number from the Page, and writing one is a known-broken path (subcodes 1487246 /
 * 2446886) even when Ads Manager accepts the identical payload.
 */

/** ODAX objective for a new CTWA campaign. */
export const WHATSAPP_CAMPAIGN_OBJECTIVE = "OUTCOME_ENGAGEMENT";

/** `destination_type` on the ad set. */
export const WHATSAPP_DESTINATION_TYPE = "WHATSAPP";

/** `optimization_goal` — bid for conversations started, which is what the result counts. */
export const WHATSAPP_OPTIMIZATION_GOAL = "CONVERSATIONS";

/** How Meta bills a CTWA ad set. */
export const WHATSAPP_BILLING_EVENT = "IMPRESSIONS";

/** The creative's `link`. Meta requires this exact endpoint for a CTWA ad. */
export const WHATSAPP_AD_LINK = "https://api.whatsapp.com/send";

/** The only `call_to_action.type` Meta accepts for WhatsApp (SEND_MESSAGE does not exist). */
export const WHATSAPP_CTA_TYPE = "WHATSAPP_MESSAGE";

/**
 * The insights `action_type` that IS the result of a CTWA ad set — the number the product
 * reports as "conversas iniciadas", and the denominator of its cost.
 */
export const WHATSAPP_RESULT_ACTION_TYPE =
  "onsite_conversion.messaging_conversation_started_7d";

/**
 * The two texts of the WhatsApp greeting.
 *
 * Without a `page_welcome_message` the customer's first message is Meta's own default —
 * "Hello! Can I get more info on this?" — which is both English and says nothing about which
 * ad the person came from. `autofillMessage` is what arrives already typed in the customer's
 * chat box; `greeting` is what the business shows above it.
 */
export type WhatsappWelcomeMessage = {
  autofillMessage: string;
  greeting?: string;
};

/** Meta's default greeting, quoted so the UI can say what happens when nothing is set. */
export const WHATSAPP_DEFAULT_AUTOFILL = "Hello! Can I get more info on this?";

/** `promoted_object` for a CTWA ad set. Only the Page — see the file header. */
export function whatsappPromotedObject(pageId: string): { page_id: string } {
  return { page_id: pageId };
}

/**
 * `call_to_action` for a CTWA creative.
 *
 * `link` is what carries the destination for every format that has nowhere else to put it.
 * `link_data` has its own top-level `link`, so Meta's link_data example leaves the CTA value
 * with `app_destination` alone; `video_data` and an Instagram-post boost have no such field,
 * and Meta's own Instagram-content example writes
 * `value: { link: "https://api.whatsapp.com/send", app_destination: "WHATSAPP" }`.
 * Passing the link is therefore always correct and, for those two formats, the only way the
 * creative names a destination at all.
 */
export function whatsappCallToAction(link?: string): {
  type: string;
  value: { app_destination: string; link?: string };
} {
  return {
    type: WHATSAPP_CTA_TYPE,
    value: {
      ...(link ? { link } : {}),
      app_destination: WHATSAPP_DESTINATION_TYPE,
    },
  };
}

/**
 * The documented CTWA contract, in one object, so tests can pin every field
 * without reconstructing it from scattered call sites.
 */
export function whatsappMetaContract() {
  return {
    campaignObjective: WHATSAPP_CAMPAIGN_OBJECTIVE,
    destinationType: WHATSAPP_DESTINATION_TYPE,
    optimizationGoal: WHATSAPP_OPTIMIZATION_GOAL,
    billingEvent: WHATSAPP_BILLING_EVENT,
    adLink: WHATSAPP_AD_LINK,
    ctaType: WHATSAPP_CTA_TYPE,
    resultActionType: WHATSAPP_RESULT_ACTION_TYPE,
  } as const;
}

/**
 * `page_welcome_message` for `link_data` / `video_data`, as a JSON STRING.
 *
 * Meta's reference documents the object but its own example passes the field as a quoted
 * string (`"page_welcome_message": "<PAGE_WELCOME_MESSAGE>"`), so we encode once here instead
 * of leaving each creative builder to guess.
 *
 * CAVEAT, unverified against a live publish: Meta documents this field ONLY inside
 * `object_story_spec.link_data`. A video ad has no `link_data`, and an Instagram-post boost
 * posts its fields flat, so both carry the greeting somewhere the reference does not describe
 * (`video_data.page_welcome_message` and a top-level creative field). If Meta ignores it there,
 * the customer sees Meta's own default — the same outcome as not sending it — so it is sent on
 * a best-effort basis rather than withheld.
 *
 * Returns `undefined` for an empty message so the caller can spread it away and let Meta fall
 * back to its default rather than posting an empty greeting.
 */
export function buildPageWelcomeMessage(
  message: WhatsappWelcomeMessage | undefined,
): string | undefined {
  const autofill = message?.autofillMessage?.trim();
  if (!autofill) return undefined;

  const greeting = message?.greeting?.trim();
  return JSON.stringify({
    type: "VISUAL_EDITOR",
    version: 2,
    landing_screen_type: "welcome_message",
    media_type: "text",
    text_format: {
      customer_action_type: "autofill_message",
      message: {
        autofill_message: { content: autofill },
        ...(greeting ? { text: greeting } : {}),
      },
    },
  });
}
