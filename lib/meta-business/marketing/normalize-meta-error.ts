import { attachCorrelationId } from "@/lib/observability/correlation-id";

/**
 * Centralized error handling for Meta Marketing API responses.
 * Normalizes Meta API errors into a consistent user-facing format with
 * entity-level context, blame fields, and actionable guidance.
 */

export type CampaignCreationLevel =
  | "audience"
  | "pixel"
  | "page"
  | "campaign"
  | "adset"
  | "adcreative"
  | "ad"
  | "upload";

/**
 * Meta API error structure (from Facebook Graph API)
 */
export type MetaApiErrorPayload = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
  error_data?: string;
  is_transient?: boolean;
};

export type MetaApiErrorResponse = {
  error?: MetaApiErrorPayload;
};

/**
 * Custom error that preserves Meta's user-facing error fields,
 * error codes, blame fields, and the entity level where it occurred.
 */
export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly metaError?: {
      error_user_title?: string;
      error_user_msg?: string;
      code?: number;
      error_subcode?: number;
      blame_field_specs?: string[][];
      is_transient?: boolean;
    },
    public readonly level?: CampaignCreationLevel,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

/**
 * Creates a MetaApiError from a Meta API error response.
 * Captures error codes, blame_field_specs from error_data, and the entity level.
 */
export function createMetaApiError(
  metaErrorResponse: MetaApiErrorResponse,
  fallbackMessage: string,
  level?: CampaignCreationLevel,
): MetaApiError {
  const err = metaErrorResponse?.error;
  const message = err?.message ?? fallbackMessage;

  let blame_field_specs: string[][] | undefined;
  if (err?.error_data) {
    try {
      const errorData =
        typeof err.error_data === "string"
          ? JSON.parse(err.error_data)
          : err.error_data;
      blame_field_specs = errorData?.blame_field_specs;
    } catch {
      /* ignore parse errors */
    }
  }

  return new MetaApiError(
    message,
    {
      error_user_title: err?.error_user_title,
      error_user_msg: err?.error_user_msg,
      code: err?.code,
      error_subcode: err?.error_subcode,
      blame_field_specs,
      is_transient: err?.is_transient,
    },
    level,
  );
}

/**
 * Normalized error format returned to the frontend.
 * Includes structured data for entity-level error display.
 */
export type NormalizedCampaignError = {
  error_user_title: string;
  error_user_msg: string;
  error_level?: CampaignCreationLevel;
  error_code?: number;
  error_subcode?: number;
  blame_fields?: string[][];
  is_transient?: boolean;
};

/**
 * Optional Meta-normalized fields included in campaign creation API error JSON
 * (spread alongside success/message). Use when typing route error responses consumed by the app.
 */
export type CampaignCreationApiErrorExtensions = {
  error_level?: CampaignCreationLevel;
  error_code?: number;
  error_subcode?: number;
  blame_fields?: string[][];
  is_transient?: boolean;
};

/** Fallback messages when Meta does not provide user-facing fields */
const FALLBACK_TITLE = "Erro na campanha";
const FALLBACK_MSG = "Ocorreu um erro ao criar a campanha. Tente novamente.";

/**
 * Maximum number of cards allowed in a Meta/Instagram carousel AD.
 * Organic Instagram carousels allow up to 20 items, but carousel ads
 * (child_attachments) are capped at 10. Promoting an existing Instagram
 * carousel post with more than 10 items triggers Meta error (#105)
 * "param child_attachments has too many elements".
 * See: https://developers.facebook.com/docs/marketing-api/reference/ad-creative-link-data/
 */
export const CAROUSEL_AD_MAX_ITEMS = 10;

const CAROUSEL_TOO_MANY_TITLE = "Carrossel com itens demais";

/** Builds the user-facing message for the carousel-too-many-items case. */
export function carouselTooManyItemsUserMessage(itemCount?: number): string {
  const countPart =
    typeof itemCount === "number" && itemCount > 0
      ? `Este post é um carrossel com ${itemCount} itens. `
      : "Este post é um carrossel com mais itens do que o permitido. ";
  return (
    `${countPart}Anúncios de carrossel permitem no máximo ${CAROUSEL_AD_MAX_ITEMS} itens ` +
    `(imagens/vídeos). Escolha outro post ou um carrossel com até ${CAROUSEL_AD_MAX_ITEMS} itens.`
  );
}

/**
 * Detects the Meta (#105) "child_attachments has too many elements" error,
 * which happens when promoting an Instagram carousel post with more than
 * CAROUSEL_AD_MAX_ITEMS items.
 */
export function isCarouselTooManyItemsError(error: MetaApiError): boolean {
  const message = (error.message ?? "").toLowerCase();
  const mentionsChildAttachments = message.includes("child_attachments");
  return (
    mentionsChildAttachments &&
    (message.includes("too many") || error.metaError?.code === 105)
  );
}

/**
 * Builds a MetaApiError carrying the friendly, localized carousel-limit
 * message. Use it to fail fast (before calling Meta) when we already know the
 * carousel exceeds the ad limit.
 */
export function createCarouselTooManyItemsError(
  itemCount?: number,
  level: CampaignCreationLevel = "adcreative",
): MetaApiError {
  return new MetaApiError(
    `Instagram carousel has ${itemCount ?? "more than " + CAROUSEL_AD_MAX_ITEMS} items but ad carousels allow at most ${CAROUSEL_AD_MAX_ITEMS} (child_attachments).`,
    {
      error_user_title: CAROUSEL_TOO_MANY_TITLE,
      error_user_msg: carouselTooManyItemsUserMessage(itemCount),
      code: 105,
    },
    level,
  );
}

/**
 * Creates a standardized error object for campaign API responses.
 * Use with NextResponse.json(createCampaignErrorJson(...), { status }).
 */
export function createCampaignErrorJson(
  error: string,
  message: string,
  details?: string,
): {
  success: false;
  error: string;
  message: string;
  error_user_title: string;
  error_user_msg: string;
  details?: string;
} {
  return attachCorrelationId({
    success: false,
    error,
    message,
    error_user_title: error,
    error_user_msg: message,
    ...(details && { details }),
  });
}

/**
 * Normalizes any error into the standard format for API responses.
 * Preserves all structured error data from MetaApiError.
 */
export function normalizeMetaError(
  error: unknown,
): NormalizedCampaignError {
  if (error instanceof MetaApiError) {
    const isCarouselLimit = isCarouselTooManyItemsError(error);
    return {
      error_user_title: isCarouselLimit
        ? CAROUSEL_TOO_MANY_TITLE
        : (error.metaError?.error_user_title ?? FALLBACK_TITLE),
      error_user_msg: isCarouselLimit
        ? (error.metaError?.error_user_msg ?? carouselTooManyItemsUserMessage())
        : (error.metaError?.error_user_msg ?? error.message),
      error_level: error.level,
      error_code: error.metaError?.code,
      error_subcode: error.metaError?.error_subcode,
      blame_fields: error.metaError?.blame_field_specs,
      is_transient: error.metaError?.is_transient,
    };
  }

  if (error instanceof Error) {
    return {
      error_user_title: FALLBACK_TITLE,
      error_user_msg: error.message,
    };
  }

  return {
    error_user_title: FALLBACK_TITLE,
    error_user_msg: FALLBACK_MSG,
  };
}
