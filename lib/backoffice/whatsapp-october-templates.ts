/** Text-only first batch from Bernardo's October campaign (05/10/2026).
 * Group invitations, videos and the unconfigured trial CTA remain pending.
 */
export const OCTOBER_SUPPORT_URL =
  "https://wa.me/5522997259506?text=Ol%C3%A1!%20Quero%20agendar%20uma%20demonstra%C3%A7%C3%A3o%20gratuita%20da%20Automatize%20para%20tirar%20algumas%20d%C3%BAvidas.%20";

export const OCTOBER_WHATSAPP_TEMPLATES = [
  {
    date: "2026-10-05",
    title: "Você criou a conta. O que te travou?",
    name: "outubro_2026_0510_atendimento_v4",
    button: { text: "Falar com a equipe", url: "https://www.automatizemarketing.com/contato-direto/{{1}}" },
    body: `Olá, {{1}}!! Vi que você criou sua conta na Automatize, mas ainda não começou o teste… 🥲\n\nFicou alguma dúvida? Pode ser sobre campanha, orçamento, pagamento ou qualquer outra parte da ferramenta.\n\nEnvie AGORA uma mensagem para nossa equipe, e ganhe uma Reunião de Implementação Gratuita. Toque no botão abaixo. 💜`,
  },
  {
    date: "2026-10-08",
    title: "O que é assinatura e o que é verba de anúncio?",
    name: "outubro_2026_0810_assinatura_v2",
    button: { text: "Falar com a equipe", url: "https://www.automatizemarketing.com/contato-direto/{{1}}" },
    body: `Uma dúvida importante: a assinatura da Automatize e o dinheiro dos anúncios são coisas separadas.\n\nA verba que você coloca no Meta é do seu negócio e vai para os anúncios. A Automatize entra para ajudar a criar, publicar e otimizar as campanhas.\n\nO site também informa 7 dias grátis para testar e sem multa de cancelamento. Quer entender o seu caso antes de começar? Fale com a equipe: toque no botão abaixo. 💜🧞`,
  },
  {
    date: "2026-10-12",
    title: "O problema não é só criar anúncio",
    name: "outubro_2026_1210_trafego_v2",
    button: { text: "Falar com a equipe", url: "https://www.automatizemarketing.com/contato-direto/{{1}}" },
    body: `Anunciar não é só apertar “impulsionar”. Se você faz isso, está perdendo MUITO dinheiro!\n\nTem público, criativo, orçamento e otimização. E é justamente essa parte técnica que faz muitos restaurantes dependerem de agência, ou realizarem por conta própria de forma errada!\n\nA Automatize usa IA para simplificar e ajudar você a vender mais sem precisar de Agências.\n\nQuer ver como ficaria para o seu negócio? Chama a equipe: toque no botão abaixo. 💜🧞`,
  },
  {
    date: "2026-10-26",
    title: "Depois de entender, teste com apoio",
    name: "outubro_2026_2610_suporte_v2",
    button: { text: "Falar com a equipe", url: "https://www.automatizemarketing.com/contato-direto/{{1}}" },
    body: `Agora que você já viu como funciona o tráfego pago com IA, o próximo passo pode ser conhecer a plataforma por dentro.\n\nVocê não precisa fazer isso sozinho. Conta para a equipe qual é o seu restaurante e o que você quer divulgar. A gente te orienta no começo.\n\nDepois você decide se quer seguir com o trial de 7 dias.\n\nFale com a gente: toque no botão abaixo. 💜`,
  },
] as const;

export const OCTOBER_PENDING_MESSAGES = [
  { date: "2026-10-07", title: "Você não precisa contratar uma agência para começar", reason: "Aguardando vídeo e grupo" },
  { date: "2026-10-14", title: "Eu não tenho tempo para fazer meus anúncios", reason: "Aguardando vídeo e grupo" },
  { date: "2026-10-15", title: "Veja o que mudou para um restaurante real", reason: "Aguardando vídeo, case e grupo" },
  { date: "2026-10-19", title: "O que uma IA de tráfego faz no dia a dia?", reason: "Aguardando vídeo" },
  { date: "2026-10-21", title: "Entre no grupo antes de decidir", reason: "Aguardando grupo" },
  { date: "2026-10-22", title: "Aula prática: como anunciar sem ficar perdido", reason: "Aguardando grupo e detalhes da aula" },
  { date: "2026-10-28", title: "O primeiro teste pode ser a sua próxima oferta", reason: "Aguardando vídeo, grupo e link do trial" },
  { date: "2026-10-29", title: "Você não precisa decidir no escuro", reason: "Aguardando destino do segundo CTA (trial)" },
] as const;

/** Previous versions retain their approved URL. New versions identify each delivery. */
export function campaignContactButton(templateName: string) {
  if (templateName === 'outubro_2026_0510_atendimento_v3') {
    return { text: 'Falar com a equipe', url: 'https://www.automatizemarketing.com/contato-direto' };
  }
  // Preserve the approved destination for existing v2 campaigns.
  if (templateName === 'outubro_2026_0510_atendimento_v2') {
    return { text: 'Falar com a equipe', url: 'https://www.automatizemarketing.com/contato' };
  }
  const template = OCTOBER_WHATSAPP_TEMPLATES.find(item => item.name === templateName);
  return template && 'button' in template ? template.button : null;
}

export function campaignTracksClicks(templateName: string): boolean {
  return campaignContactButton(templateName)?.url.endsWith("/contato-direto/{{1}}") ?? false;
}

/** Resolve the saved campaign even when the suggested Meta template was versioned.
 * Campaigns arrive newest first; an explicitly saved current version takes priority.
 */
export function findOctoberCampaign<T extends { template_name: string }>(campaigns: readonly T[], templateName: string): T | undefined {
  const exact = campaigns.find(campaign => campaign.template_name === templateName);
  if (exact) return exact;
  if (!OCTOBER_WHATSAPP_TEMPLATES.some(template => template.name === templateName)) return undefined;
  const family = templateName.replace(/_v\d+$/, "");
  return campaigns.find(campaign => campaign.template_name.replace(/_v\d+$/, "") === family);
}
