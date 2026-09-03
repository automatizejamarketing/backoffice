/**
 * Click-to-WhatsApp (CTWA): the exact fields Meta wants, in one place.
 *
 * Campaign objective is `OUTCOME_ENGAGEMENT` — Meta's own v25.0 example in
 * https://developers.facebook.com/docs/marketing-api/ad-creative/messaging-ads/click-to-whatsapp/
 * and the destination-type matrix in
 * https://developers.facebook.com/docs/marketing-api/adset/destination_type/
 * (WHATSAPP is listed under ENGAGEMENT / TRAFFIC / AWARENESS; SALES lists only
 * WEBSITE, MESSENGER, PHONE_CALL). The previous OUTCOME_SALES shape was verified
 * live against a production campaign but rides an undocumented combination.
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

/** `call_to_action` for a CTWA creative, in the shape Meta's reference spells out. */
export function whatsappCallToAction(): {
  type: string;
  value: { app_destination: string };
} {
  return {
    type: WHATSAPP_CTA_TYPE,
    value: { app_destination: WHATSAPP_DESTINATION_TYPE },
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
 * string; the Graph API accepts the encoded form on both `link_data` and `video_data`, so we
 * encode once here instead of leaving each creative builder to guess.
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
