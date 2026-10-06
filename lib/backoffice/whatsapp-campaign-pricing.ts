/** Public BRL reference from Meta's calculator; not an account billing quote. */
export const META_PRICING_SOURCE = "https://whatsappbusiness.com/products/platform-pricing/";
export type CampaignPricing = { unitCostMicros: number; currency: "BRL"; category: "MARKETING"; market: "BR"; checkedAt: string; source: string };

export async function fetchCampaignPricing(request: typeof fetch = fetch): Promise<CampaignPricing> {
  const page = await request(META_PRICING_SOURCE, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!page.ok) throw new Error("Não foi possível consultar a tarifa da Meta.");
  // The public calculator supplies its own nonce. Never persist it or use account credentials.
  const nonce = /"restNonce":"([^"\\]+)"/.exec(await page.text())?.[1];
  if (!nonce) throw new Error("A tabela da Meta está indisponível. Tente atualizar novamente.");
  const query = new URLSearchParams({ market: "BR", currency: "BRL", category: "Marketing", _wab_nonce: nonce });
  const response = await request(`https://whatsappbusiness.com/wp-json/wab/v1/pricing?${query}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Não foi possível consultar a tarifa da Meta.");
  const data: unknown = await response.json();
  const quote = data && typeof data === "object" && "quote" in data ? data.quote : null;
  if (typeof quote !== "string" || !/^\d+\.\d{1,6}$/.test(quote)) throw new Error("A Meta retornou uma tarifa inválida.");
  const unitCostMicros = Math.round(Number(quote) * 1_000_000);
  if (!Number.isSafeInteger(unitCostMicros) || unitCostMicros <= 0 || unitCostMicros > 100_000_000) throw new Error("A Meta retornou uma tarifa inválida.");
  return { unitCostMicros, currency: "BRL", category: "MARKETING", market: "BR", checkedAt: new Date().toISOString(), source: META_PRICING_SOURCE };
}

let cached: CampaignPricing | undefined;
let pending: Promise<CampaignPricing> | undefined;
export async function getCampaignPricing(): Promise<CampaignPricing> {
  if (cached && Date.now() - Date.parse(cached.checkedAt) < 3_600_000) return cached;
  if (!pending) pending = fetchCampaignPricing().then(result => { cached = result; return result; }).finally(() => { pending = undefined; });
  return pending;
}
