/**
 * Conventional Meta campaign / ad-set / ad naming — matches the wizard's
 * server-side name generation so campaigns the AI chat creates look identical to
 * wizard-created ones in the user's account:
 *
 *   Campaign: [AM][OBJETIVO][NICHE][YYYY-MM-DD-HH-mm-SS]   (timestamp in UTC)
 *   Ad set:   <campaignName> - Ad Set
 *   Ad:       <campaignName> - Ad          (or " - Ad 1", " - Ad 2" for multiple)
 *
 * The wizard hardcodes the codes per niche/objective route; this replicates them
 * for the chat. Codes verified against app/api/meta-business/marketing/campaign/**.
 */

/** ODAX objective → the wizard's objective code. */
const OBJECTIVE_CODE: Record<string, string> = {
  OUTCOME_TRAFFIC: "TRAFEGO",
  OUTCOME_SALES: "VENDAS",
  OUTCOME_LEADS: "LEADS",
  // No wizard equivalent — sensible codes in the same style:
  OUTCOME_ENGAGEMENT: "ENGAJAMENTO",
  OUTCOME_AWARENESS: "RECONHECIMENTO",
  OUTCOME_APP_PROMOTION: "APP",
};

/** companies.niche (resolved) → the wizard's niche code. Unknown/absent → OUT. */
const NICHE_CODE: Record<string, string> = {
  food_service: "FS",
  retail: "VJ",
  real_estate_broker: "CI",
  insurance_broker: "SV",
  // O backoffice usa o nicho `service` como sinônimo de corretor de seguros
  // (ele mesmo normaliza um para o outro no fluxo de IA). O código existia só
  // na cópia espelhada; trazê-lo para o lado autoritativo evita que o próximo
  // `sync:meta` apague o mapeamento e mude o nome das campanhas de lá.
  service: "SV",
  outros: "OUT",
};

/** Same construction as the wizard routes: UTC ISO, T→-, :→-, sliced to 19 chars. */
function conventionalTimestamp(): string {
  return new Date().toISOString().replace("T", "-").replace(/:/g, "-").slice(0, 19);
}

/**
 * `[AM][OBJETIVO][NICHE][timestamp]` — the default campaign name.
 *
 * `destination` exists because the ODAX objective is not enough to name the campaign once the
 * DESTINATION varies. New CTWA campaigns are OUTCOME_ENGAGEMENT; legacy ones stay
 * OUTCOME_SALES. The name is `[WHATSAPP]` either way so Ads Manager, reports and the
 * playbook can tell them from website sales. Absent (or `"website"`) keeps the historical
 * name byte-for-byte.
 */
export function buildConventionalCampaignName(
  objective: string,
  niche?: string | null,
  destination?: "website" | "whatsapp" | null,
): string {
  const obj =
    destination === "whatsapp" ? "WHATSAPP" : (OBJECTIVE_CODE[objective] ?? "CAMPANHA");
  const nic = NICHE_CODE[(niche ?? "").trim()] ?? "OUT";
  return `[AM][${obj}][${nic}][${conventionalTimestamp()}]`;
}

/** `<campaignName> - Ad Set` (with an index suffix when there is more than one). */
export function buildConventionalAdSetName(
  campaignName: string,
  index?: number,
  total?: number,
): string {
  const suffix =
    typeof index === "number" && typeof total === "number" && total > 1
      ? ` ${index + 1}`
      : "";
  return `${campaignName} - Ad Set${suffix}`;
}

/** `<campaignName> - Ad` (with an index suffix when there is more than one). */
export function buildConventionalAdName(
  campaignName: string,
  index?: number,
  total?: number,
): string {
  const suffix =
    typeof index === "number" && typeof total === "number" && total > 1
      ? ` ${index + 1}`
      : "";
  return `${campaignName} - Ad${suffix}`;
}
