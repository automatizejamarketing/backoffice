import { metaApiCall } from "@/lib/meta-business/api";

const SALES_OBJECTIVES = new Set(["OUTCOME_SALES", "CONVERSIONS"]);

export function isSalesCampaignObjective(objective?: string): boolean {
  return objective != null && SALES_OBJECTIVES.has(objective);
}

export function isValidDuplicatePromotionUrl(value: string): boolean {
  return /^https:\/\/.+/i.test(value.trim());
}

type DuplicateEntityType = "campaign" | "adset" | "ad";

async function fetchCampaignObjective(
  entityType: DuplicateEntityType,
  entityId: string,
  accessToken: string,
): Promise<string | undefined> {
  if (entityType === "campaign") {
    const campaign = await metaApiCall<{ objective?: string }>({
      domain: "FACEBOOK",
      method: "GET",
      path: entityId,
      params: "fields=objective",
      accessToken,
    });
    return campaign.objective;
  }

  if (entityType === "adset") {
    const adset = await metaApiCall<{ campaign?: { objective?: string } }>({
      domain: "FACEBOOK",
      method: "GET",
      path: entityId,
      params: "fields=campaign{objective}",
      accessToken,
    });
    return adset.campaign?.objective;
  }

  const ad = await metaApiCall<{
    adset?: { campaign?: { objective?: string } };
  }>({
    domain: "FACEBOOK",
    method: "GET",
    path: entityId,
    params: "fields=adset{campaign{objective}}",
    accessToken,
  });
  return ad.adset?.campaign?.objective;
}

export type DuplicatePromotionUrlValidation =
  | { ok: true; promotionUrl?: string }
  | {
      ok: false;
      error: { error: string; message: string; solution?: string };
    };

/**
 * Sales campaigns require a valid https promotion URL on every duplicate request.
 * Non-sales campaigns ignore the field.
 */
export async function validateDuplicatePromotionUrl(args: {
  entityType: DuplicateEntityType;
  entityId: string;
  promotionUrl: string | undefined;
  accessToken: string;
}): Promise<DuplicatePromotionUrlValidation> {
  const objective = await fetchCampaignObjective(
    args.entityType,
    args.entityId,
    args.accessToken,
  );

  if (!isSalesCampaignObjective(objective)) {
    return { ok: true };
  }

  const trimmed = args.promotionUrl?.trim() ?? "";
  if (!trimmed) {
    return {
      ok: false,
      error: {
        error: "Missing promotionUrl",
        message:
          "Informe a URL de promoção para duplicar campanhas de vendas.",
        solution: "Forneça uma URL válida começando com https://.",
      },
    };
  }

  if (!isValidDuplicatePromotionUrl(trimmed)) {
    return {
      ok: false,
      error: {
        error: "Invalid promotionUrl",
        message:
          "Informe uma URL de promoção válida começando com https://.",
      },
    };
  }

  return { ok: true, promotionUrl: trimmed };
}
