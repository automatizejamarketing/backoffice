/**
 * Família do objetivo da campanha, para o selo do dossiê: o consultor precisa
 * separar de relance campanha de vendas de campanha de tráfego (CPC barato de
 * tráfego não se compara com custo por compra).
 */

export type ObjectiveFamily = "vendas" | "trafego" | "cadastros" | "mensagens" | "reconhecimento" | "app" | "outro";

const FAMILY: Record<string, ObjectiveFamily> = {
  OUTCOME_SALES: "vendas",
  CONVERSIONS: "vendas",
  PRODUCT_CATALOG_SALES: "vendas",
  STORE_VISITS: "vendas",
  OUTCOME_TRAFFIC: "trafego",
  LINK_CLICKS: "trafego",
  OUTCOME_LEADS: "cadastros",
  LEAD_GENERATION: "cadastros",
  OUTCOME_ENGAGEMENT: "mensagens",
  MESSAGES: "mensagens",
  POST_ENGAGEMENT: "mensagens",
  PAGE_LIKES: "mensagens",
  EVENT_RESPONSES: "mensagens",
  VIDEO_VIEWS: "reconhecimento",
  OUTCOME_AWARENESS: "reconhecimento",
  BRAND_AWARENESS: "reconhecimento",
  REACH: "reconhecimento",
  OUTCOME_APP_PROMOTION: "app",
  APP_INSTALLS: "app",
};

export const OBJECTIVE_FAMILY_LABEL: Record<ObjectiveFamily, string> = {
  vendas: "Vendas",
  trafego: "Tráfego",
  cadastros: "Cadastros",
  mensagens: "Mensagens/Engajamento",
  reconhecimento: "Reconhecimento",
  app: "App",
  outro: "Outro objetivo",
};

export function objectiveFamily(objective: string | null | undefined): ObjectiveFamily | null {
  if (!objective) return null;
  return FAMILY[objective.toUpperCase()] ?? "outro";
}
