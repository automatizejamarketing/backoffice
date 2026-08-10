/**
 * Read-only catalog of Automatize frontend WhatsApp remarketing / activation
 * nudges. Timings and copy live hardcoded in automatize-frontend; this panel
 * surfaces them so ops can see the full alert surface in one place.
 */

export type RemarketingNudgeDefinition = {
  ruleKey: string;
  title: string;
  description: string;
  /** Meta template / notification type name. */
  templateName: string;
  audience: "client";
  channel: "whatsapp";
  /** Human delay shown as production default. */
  delayProduction: string;
  /** Human delay used on staging / preview / local. */
  delayStaging: string;
  trigger: string;
  bodyPreview: string;
  ctaLabel: string;
  ctaUrl: string;
  editable: false;
};

export const REMARKETING_WHATSAPP_NUDGES: readonly RemarketingNudgeDefinition[] =
  [
    {
      ruleKey: "signup_nudge_15m",
      title: "Ativação pré-trial · 15 min",
      description:
        "WhatsApp após cadastro se o usuário ainda não iniciou o teste grátis.",
      templateName: "signup_nudge_15m_v2",
      audience: "client",
      channel: "whatsapp",
      delayProduction: "15 minutos após o cadastro",
      delayStaging: "5 minutos após o cadastro",
      trigger: "Signup / telefone completo (ainda sem trial)",
      bodyPreview:
        "Olá! Vimos que você criou sua conta na Automatize, mas ainda não iniciou seu teste grátis. … fale com nosso especialista.",
      ctaLabel: "Falar com especialista",
      ctaUrl: "https://www.automatizemarketing.com/especialista",
      editable: false,
    },
    {
      ruleKey: "signup_nudge_1d",
      title: "Ativação pré-trial · 1 dia",
      description:
        "Segundo WhatsApp se o usuário segue sem trial ~24h após o cadastro.",
      templateName: "signup_nudge_1d_v2",
      audience: "client",
      channel: "whatsapp",
      delayProduction: "~1 dia após o cadastro (15m + 1425m)",
      delayStaging: "~20 minutos após o cadastro (5m + 15m)",
      trigger: "Ainda sem trial após o primeiro nudge",
      bodyPreview:
        "Você está perdendo tempo e dinheiro… Seu teste grátis da Automatize ainda está disponível. … converse com nosso especialista.",
      ctaLabel: "Falar com especialista",
      ctaUrl: "https://www.automatizemarketing.com/especialista",
      editable: false,
    },
    {
      ruleKey: "trial_onboarding_nudge_30m",
      title: "Onboarding do trial · 30 min",
      description:
        "WhatsApp após o trial começar, convidando a agendar onboarding.",
      templateName: "trial_onboarding_nudge_30m_v1",
      audience: "client",
      channel: "whatsapp",
      delayProduction: "30 minutos após o início do trial",
      delayStaging: "5 minutos após o início do trial",
      trigger: "Trial Stripe ativo (após checkout / webhook)",
      bodyPreview:
        "Olá! Seu teste da Automatize já começou. … agende uma conversa gratuita de 30 minutos com nosso consultor.",
      ctaLabel: "Agendar onboarding",
      ctaUrl:
        "https://calendly.com/lucashaddad-infinitegrowth/30min",
      editable: false,
    },
  ];
