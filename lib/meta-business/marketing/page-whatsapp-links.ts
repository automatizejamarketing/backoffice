/**
 * Where the user goes on Meta to link or change the WhatsApp number of a Page.
 *
 * Deliberately free of imports. The destination card is a Client Component, and pulling these
 * from `page-whatsapp-number.ts` dragged `metaApiCall` — and with it `node:async_hooks` — into
 * the browser bundle, which fails the Turbopack build outright.
 */

/**
 * The Page settings WhatsApp tab is the surface that owns the Page↔number link.
 *
 * Unverified against a real browser session: it is a UI route, so no Graph call can confirm it.
 * {@link pageWhatsappBusinessSuiteUrl} is kept as the documented alternative.
 */
export function pageWhatsappSettingsUrl(pageId: string): string {
  return `https://www.facebook.com/${encodeURIComponent(pageId)}/settings/?tab=whatsapp`;
}

/** Same destination as settings — adding and editing happen on that tab. */
export function pageWhatsappAddUrl(pageId: string): string {
  return pageWhatsappSettingsUrl(pageId);
}

/** Same destination as settings — adding and editing happen on that tab. */
export function pageWhatsappEditUrl(pageId: string): string {
  return pageWhatsappSettingsUrl(pageId);
}

/** Documented fallback: Business Suite WhatsApp accounts (expects a WABA asset id). */
export function pageWhatsappBusinessSuiteUrl(pageId: string): string {
  return `https://business.facebook.com/latest/settings/whatsapp_account?asset_id=${encodeURIComponent(pageId)}`;
}
