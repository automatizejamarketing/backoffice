/**
 * The WhatsApp number a click-to-WhatsApp campaign will actually send people to.
 *
 * A CTWA ad set promotes the PAGE (`promoted_object: { page_id }`) and Meta resolves the number
 * from it — nothing in the campaign payload names a phone number. So the only way to tell the
 * user where their ad leads is to read it off the Page or off a WABA.
 *
 * Resolution order (first hit wins):
 *   1. `/{business_id}/owned_whatsapp_business_accounts{phone_numbers}` — needs
 *      `whatsapp_business_management` Advanced access for WABAs this app does not own.
 *      Standard access returns Graph #200; that is treated as "could not look".
 *   2. Page fields `whatsapp_number` / `has_whatsapp_number` — listed under PPCA/PPMA
 *      and typically stripped on the new Page experience.
 *
 * Reading the number back off an existing CTWA ad set looks like a third source, and the
 * AdPromotedObject reference lists `whatsapp_phone_number` as a default field. It is not one:
 * probed against six live CTWA ad sets, `promoted_object` came back as
 * `{ page_id, smart_pse_enabled }` every time, and filtering the ad-set list by
 * `destination_type` is refused outright (Graph #100). It was removed rather than fixed —
 * an unfiltered list of every ad set in the account, on every lookup, to find a field Meta
 * does not populate. See ADR 0027.
 *
 * `unknown` MUST NOT be presented as "this Page has no WhatsApp number" nor block
 * publishing: it means we are not allowed to look. Only an explicit
 * `has_whatsapp_number === false` is evidence of absence. Under the app's current access
 * every lookup ends in `unknown`, so the UI names the Page instead of a number.
 *
 * The links that send the user to Meta live in `page-whatsapp-links.ts`, which the client
 * bundle can import without dragging this module's Graph client along.
 */
import { metaApiCall } from "@/lib/meta-business/api";
import { GraphApiError } from "@/lib/meta-business/error";

export type PageWhatsappNumberSource = "owned_waba" | "page_fields";

export type PageWhatsappNumber =
  /** The Page has a number AND we could read it. */
  | { status: "linked"; number: string; source: PageWhatsappNumberSource }
  /** The Page has a number but Meta only told us it exists, not which one. */
  | { status: "linked_unknown_number"; source?: PageWhatsappNumberSource }
  /** Meta explicitly said there is none. The only state that justifies blocking. */
  | { status: "not_linked" }
  /**
   * We could not look: the fields were stripped, Standard-access WABA #200,
   * the Page is not administered by this connection (#10), or the call failed.
   */
  | { status: "unknown"; reason: "no_permission" | "request_failed" };

export type GetPageWhatsappNumberOptions = {
  businessId?: string | null;
};

/** The Page fields that carry the linked WhatsApp number. */
const PAGE_WHATSAPP_FIELDS =
  "id,whatsapp_number,has_whatsapp_number,has_whatsapp_business_number,business";

type PageWhatsappFields = {
  id?: string;
  whatsapp_number?: string;
  has_whatsapp_number?: boolean;
  has_whatsapp_business_number?: boolean;
  business?: { id?: string };
};

function graphCode(error: unknown): number | undefined {
  return error instanceof GraphApiError
    ? error.errorReturn.data?.code
    : undefined;
}

function interpretPageFields(page: PageWhatsappFields): PageWhatsappNumber {
  const number = page.whatsapp_number?.trim();
  if (number) {
    return { status: "linked", number, source: "page_fields" };
  }
  if (page.has_whatsapp_number === true) {
    return { status: "linked_unknown_number", source: "page_fields" };
  }
  if (page.has_whatsapp_number === false) {
    return { status: "not_linked" };
  }
  return { status: "unknown", reason: "no_permission" };
}

export function interpretPageWhatsappFields(
  page: PageWhatsappFields,
): PageWhatsappNumber {
  return interpretPageFields(page);
}

type WabaPhone = {
  display_phone_number?: string;
  verified_name?: string;
  status?: string;
};

async function fromOwnedWabas(
  accessToken: string,
  businessId: string,
): Promise<PageWhatsappNumber | null> {
  const response = await metaApiCall<{
    data?: Array<{ phone_numbers?: { data?: WabaPhone[] } | WabaPhone[] }>;
  }>({
    domain: "FACEBOOK",
    method: "GET",
    path: `${businessId}/owned_whatsapp_business_accounts`,
    params: "fields=id,name,phone_numbers{display_phone_number,verified_name,status}",
    accessToken,
  });

  const numbers: string[] = [];
  for (const waba of response.data ?? []) {
    const phones = Array.isArray(waba.phone_numbers)
      ? waba.phone_numbers
      : (waba.phone_numbers?.data ?? []);
    for (const phone of phones) {
      const display = phone.display_phone_number?.trim();
      if (display) numbers.push(display);
    }
  }

  if (numbers.length === 1) {
    return { status: "linked", number: numbers[0], source: "owned_waba" };
  }
  if (numbers.length > 1) {
    return { status: "linked_unknown_number", source: "owned_waba" };
  }
  return null;
}

/**
 * Read the WhatsApp number linked to a Page.
 *
 * Never throws: every failure collapses into `unknown`, because the caller's job is to decide
 * what to SHOW, and an exception here would be indistinguishable from "no number" at the UI.
 */
export async function getPageWhatsappNumber(
  accessToken: string,
  pageId: string,
  options: GetPageWhatsappNumberOptions = {},
): Promise<PageWhatsappNumber> {
  let page: PageWhatsappFields;
  try {
    page = await metaApiCall<PageWhatsappFields>({
      domain: "FACEBOOK",
      method: "GET",
      path: pageId,
      params: `fields=${PAGE_WHATSAPP_FIELDS}`,
      accessToken,
    });
  } catch (error) {
    const code = graphCode(error);
    return {
      status: "unknown",
      reason: code === 10 || code === 200 ? "no_permission" : "request_failed",
    };
  }

  const businessId = options.businessId?.trim() || page.business?.id;
  if (businessId) {
    try {
      const fromWaba = await fromOwnedWabas(accessToken, businessId);
      if (fromWaba) return fromWaba;
    } catch {
      // Fall through to Page fields.
    }
  }

  return interpretPageFields(page);
}
