/**
 * acceptCustomAudienceTos â€” accept the Custom Audiences Terms of Service for an ad
 * account (POST /act_/customaudiencestos), required before any custom audience can
 * be created (ADR 0017). CONSENT-GATED: the assistant calls this ONLY after an
 * explicit user "yes" â€” never silently. Alternatively the user accepts in Ads
 * Manager.
 */

import { metaApiCall } from "@/lib/meta-business/api";
type TermsResult =
  | { ok: true; id: string }
  | { ok: false; message: string; issues: Array<{ code: string; reason: string; suggestion: string }> };

function formatAccountId(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

export async function acceptCustomAudienceTos(input: {
  adAccountId: string;
  accessToken: string;
}): Promise<TermsResult> {
  const account = formatAccountId(input.adAccountId);
  try {
    await metaApiCall<{ success?: boolean }>({
      method: "POST",
      path: `${account}/customaudiencestos`,
      params: "",
      body: new URLSearchParams(),
      accessToken: input.accessToken,
    });
    return { ok: true, id: account };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível aceitar os termos.";
    return { ok: false, message, issues: [{ code: "META_TOS_ACCEPT_FAILED", reason: message, suggestion: "Aceite os termos no Gerenciador de Anúncios e tente novamente." }] };
  }
}
