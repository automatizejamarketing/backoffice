/**
 * Links para o Gerenciador de Anúncios da Meta. Só abrem a conta se o
 * Facebook de quem clica tiver acesso a ela — sem acesso, o caminho é o
 * Marketing do cliente no backoffice.
 */

const BASE = "https://adsmanager.facebook.com/adsmanager/manage";

/** "act_123" ou "123" → "123"; null se não parecer id de conta. */
export function bareAccountId(accountId: string | null | undefined): string | null {
  const bare = String(accountId ?? "").trim().replace(/^act_/, "");
  return /^\d{3,25}$/.test(bare) ? bare : null;
}

export function adsManagerCampaignsUrl(accountId: string | null | undefined): string | null {
  const act = bareAccountId(accountId);
  return act ? `${BASE}/campaigns?act=${act}` : null;
}

/** Conjuntos da campanha, com ela selecionada. */
export function adsManagerCampaignUrl(accountId: string | null | undefined, campaignId: string): string | null {
  const act = bareAccountId(accountId);
  if (!act || !/^\d{3,25}$/.test(campaignId)) return null;
  return `${BASE}/adsets?act=${act}&selected_campaign_ids=${campaignId}`;
}

export function adsManagerAdUrl(accountId: string | null | undefined, adId: string): string | null {
  const act = bareAccountId(accountId);
  if (!act || !/^\d{3,25}$/.test(adId)) return null;
  return `${BASE}/ads?act=${act}&selected_ad_ids=${adId}`;
}

export const ADS_MANAGER_HINT =
  "Só abre se o seu Facebook tiver acesso a esta conta de anúncios. Sem acesso, use o Marketing do cliente.";
