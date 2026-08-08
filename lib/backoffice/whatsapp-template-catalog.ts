import { getWhatsappTemplateLabel } from "./whatsapp-history-model";

export type WhatsappTemplatePreviewPart =
  | { type: "body"; text: string }
  | { type: "button"; text: string };

export type WhatsappTemplateCatalogEntry = {
  businessRule: string;
  preview: WhatsappTemplatePreviewPart[];
};

const SPECIALIST_TEMPLATE_REDIRECT_URL =
  "https://www.automatizemarketing.com/especialista";
const LUCAS_ONBOARDING_CALENDLY_URL =
  "https://calendly.com/lucashaddad-infinitegrowth/30min";

const WHATSAPP_TEMPLATE_CATALOG: Record<string, WhatsappTemplateCatalogEntry> = {
  signup_nudge_15m_v2: {
    businessRule:
      "15 minutos após o cadastro, se o usuário ainda não iniciou o trial, tem telefone de contato válido e o WhatsApp está configurado. Não dispara se o trial já começou ou se o telefone estiver ausente.",
    preview: [
      {
        type: "body",
        text: "Olá! Vimos que você criou sua conta na Automatize, mas ainda não iniciou seu teste grátis.\n\nSe quiser entender melhor como a plataforma funciona antes de cadastrar uma forma de pagamento, fale com nosso especialista. Ele pode tirar suas dúvidas e ajudar você a começar com segurança.",
      },
      {
        type: "button",
        text: "Falar com especialista",
      },
    ],
  },
  signup_nudge_1d_v2: {
    businessRule:
      "Cerca de 24 horas após o cadastro (15 min + 23h45), nas mesmas condições do nudge de 15 min: sem trial iniciado, com telefone válido e WhatsApp configurado.",
    preview: [
      {
        type: "body",
        text: "Você está perdendo tempo e dinheiro… 🕰️💸\n\nSeu teste grátis da Automatize ainda está disponível. Antes de decidir, converse com nosso especialista para entender como a plataforma funciona, tirar dúvidas sobre pagamento e receber orientação para começar com segurança.",
      },
      {
        type: "button",
        text: "Falar com especialista",
      },
    ],
  },
  trial_onboarding_nudge_30m_v1: {
    businessRule:
      "30 minutos após o início do trial Stripe, para todo usuário cujo trial ainda está ativo, com telefone de contato válido. Perfil, campanhas e vínculo com o Mat não influenciam o disparo.",
    preview: [
      {
        type: "body",
        text: "Olá! Seu teste da Automatize já começou.\n\nPara aproveitar melhor esse período, agende uma conversa gratuita de 30 minutos com nosso consultor. Ele vai mostrar os próximos passos, tirar suas dúvidas e ajudar você a aproveitar melhor a plataforma.",
      },
      {
        type: "button",
        text: "Agendar onboarding",
      },
    ],
  },
  pix_renovacao_v2: {
    businessRule:
      "Cron diário de renovação PIX: assinatura Mercado Pago ou manual ativa com vencimento em 3 ou 1 dia. Envia junto com o e-mail de renovação, com valor, vencimento e código Pix copia e cola.",
    preview: [
      {
        type: "body",
        text: "Olá, {{nome}}!\n\nSeu plano {{plano}} vence em {{data_vencimento}}. Valor: {{valor}}.\n\nCódigo Pix copia e cola:\n{{codigo_pix}}",
      },
      {
        type: "button",
        text: "Pagar com Pix",
      },
    ],
  },
  pix_pagamento_confirmado_v1: {
    businessRule:
      "Quando o Mercado Pago confirma o pagamento de uma cobrança PIX de renovação. Dispara uma única vez por pagamento confirmado.",
    preview: [
      {
        type: "body",
        text: "Olá, {{nome}}! Recebemos seu pagamento de {{valor}} referente ao plano {{plano}}.\n\nSeu acesso está garantido até {{nova_data_vencimento}}.",
      },
    ],
  },
};

export function getWhatsappTemplateCatalogEntry(
  templateName: string,
): WhatsappTemplateCatalogEntry | null {
  return WHATSAPP_TEMPLATE_CATALOG[templateName] ?? null;
}

export { getWhatsappTemplateLabel };

export const WHATSAPP_TEMPLATE_PREVIEW_URLS: Record<string, string[]> = {
  signup_nudge_15m_v2: [SPECIALIST_TEMPLATE_REDIRECT_URL],
  signup_nudge_1d_v2: [SPECIALIST_TEMPLATE_REDIRECT_URL],
  trial_onboarding_nudge_30m_v1: [LUCAS_ONBOARDING_CALENDLY_URL],
};
