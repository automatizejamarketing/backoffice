/**
 * Jornada do cliente (variação D) — regras puras, servidor e cliente.
 *
 * A etapa sai dos dados, ninguém arrasta cartão: onboarding até a primeira
 * campanha veicular, depois "rodando" ou "parado". Tags de problema podem ser
 * marcadas pelo Fred no onboarding ou detectadas sozinhas; cada uma aponta
 * para um playbook de resolução e uma mensagem pronta.
 */
import { formatMoney, formatPct, delta } from "./metrics";
import type { WorkspaceAlert, WorkspaceClient, WorkspaceState } from "./types";

/** Dados extras por cliente que só a jornada precisa (ver journey-data.ts). */
export type JourneyExtras = {
  userId: string;
  signupAt: string | null;
  companyOnboardingCompleted: boolean;
  certification: string | null;
  hasCampaign: boolean;
  firstSpendDate: string | null;
  lastSpendDate: string | null;
  crmStatus: string | null;
};

export type JourneyStage = "onboarding" | "rodando" | "parado";

export const STAGE_LABEL: Record<JourneyStage, string> = {
  onboarding: "Onboarding",
  rodando: "Campanha rodando",
  parado: "Parado",
};

export const STAGE_DESCRIPTION: Record<JourneyStage, string> = {
  onboarding: "Do trial até a primeira campanha veicular. O Fred passa o bastão com o que viu.",
  rodando: "Campanha veiculando. Dossiê curto: o que aconteceu, o que fazer, o que mandar ao cliente.",
  parado: "Já rodou e parou de veicular. Descobrir por quê e reativar.",
};

export type JourneyStepKey =
  | "acesso"
  | "fred"
  | "meta"
  | "certificacao"
  | "campanha"
  | "veiculando";

export type JourneyStep = {
  key: JourneyStepKey;
  label: string;
  done: boolean;
  /** Passo que não trava a jornada (o handoff do Fred é recomendado, não bloqueia). */
  optional?: boolean;
  hint: string;
};

export type ProblemTag = {
  key: string;
  label: string;
  description: string;
  /** Passos do playbook de resolução, em ordem. */
  playbook: string[];
  /** Mensagem pronta sugerida para o cliente. */
  templateKey: string | null;
  /** Link de referência (playbook completo); interno ou externo. */
  link?: { label: string; href: string };
  /** Detectável automaticamente pelos dados. */
  auto?: boolean;
};

export const PROBLEM_TAGS: ProblemTag[] = [
  {
    key: "certificacao_meta",
    label: "Erro de não discriminação da Meta",
    description:
      "A Meta recusa publicar (erro 100/2859024) porque o Business Manager nunca aceitou a política de não discriminação para o usuário do sistema. Os anúncios ficam “em preparação”.",
    playbook: [
      "Confirme na ficha os anúncios retidos (“em preparação”) — eles sobem sozinhos quando a conta for liberada.",
      "Peça ao cliente o login com o Facebook PESSOAL na Automatize: ao abrir Marketing aparece o aviso “Confirmar com seu Facebook”.",
      "Se o login pessoal também for recusado: peça para adicionar a Automatize em Pessoas no Business Manager (Configurações do negócio › Pessoas › Adicionar).",
      "Depois do convite aceito, reconecte como consultor pelo backoffice. A republicação é automática.",
    ],
    templateKey: "certificacao_meta",
    auto: true,
  },
  {
    key: "reconectar_facebook",
    label: "Facebook desconectado",
    description: "O token da Meta caiu (senha trocada, permissão removida ou expirou). Sem ele não lemos nem publicamos nada.",
    playbook: [
      "Mande a mensagem de reconexão — o cliente entra em Marketing › Reconectar.",
      "Se o cliente travar, ofereça uma chamada de 5 minutos e reconecte junto.",
      "Confirme que voltou: a ficha mostra “Meta ok” na próxima leitura.",
    ],
    templateKey: "reconectar_facebook",
    auto: true,
  },
  {
    key: "sem_meta",
    label: "Meta ainda não conectada",
    description: "Cliente com acesso ativo que nunca conectou o Facebook/Instagram de anúncios.",
    playbook: [
      "Verifique com o Fred se o cliente tem Business Manager e conta de anúncios.",
      "Mande o passo a passo de conexão; se não tiver BM, oriente a criar antes.",
      "Agende 15 minutos se ele não conectar em 2 dias.",
    ],
    templateKey: "conectar_meta",
    auto: true,
  },
  {
    key: "acesso_parceiro",
    label: "Falta adicionar a Automatize em Pessoas",
    description: "O BM do cliente ainda não deu acesso à Automatize como pessoa/parceiro, o que trava suporte e a saída para erros de certificação.",
    playbook: [
      "Envie o tutorial de Pessoas (Configurações do negócio › Pessoas › Adicionar › e-mail da Automatize).",
      "Peça print da tela de confirmação.",
      "Reconecte como consultor quando o convite for aceito.",
    ],
    templateKey: "adicionar_pessoas",
  },
  {
    key: "pagamento_meta",
    label: "Sem saldo ou cartão recusado na Meta",
    description: "A campanha está ativa mas não entrega: costuma ser saldo pré-pago zerado ou cartão recusado na conta de anúncios.",
    playbook: [
      "Peça ao cliente para abrir Faturamento da Meta e conferir saldo e cartão.",
      "Se for pré-pago, sugira valor que cubra a verba do mês.",
      "Confira a entrega no dia seguinte.",
    ],
    templateKey: "campanha_parada",
  },
  {
    key: "sem_resultado",
    label: "Gastando sem resultado",
    description: "Houve investimento no período e nenhuma compra, lead ou conversa.",
    playbook: [
      "Cheque se o pixel/evento de conversão está disparando (Gerenciador de Eventos).",
      "Teste o link de destino (cardápio, WhatsApp, site) no celular.",
      "Se estiver tudo certo, troque o criativo de maior gasto ou pause o conjunto.",
    ],
    templateKey: null,
    auto: true,
  },
  {
    key: "criativos",
    label: "Precisa de criativos novos",
    description: "Criativo cansado ou fraco segurando o resultado.",
    playbook: [
      "Peça 3 a 5 fotos ou vídeos curtos dos produtos mais vendidos.",
      "Suba como novos anúncios no conjunto que mais converte.",
      "Pause o criativo antigo depois de 3 dias se o novo estiver melhor.",
    ],
    templateKey: "pedir_criativos",
    auto: true,
  },
  {
    key: "pixel",
    label: "Pixel não instalado ou sem eventos",
    description: "Campanha de vendas sem pixel registrando compras.",
    playbook: [
      "Confirme no Gerenciador de Eventos se o pixel recebe PageView/Purchase.",
      "Se usar plataforma de delivery, verifique a integração do pixel lá.",
      "Enquanto não resolve, otimize para cliques no link ou conversas.",
    ],
    templateKey: "verificar_pixel",
  },
  {
    key: "conta_restrita",
    label: "Conta de anúncios restrita",
    description: "A Meta restringiu ou desativou a conta de anúncios.",
    playbook: [
      "Peça print da Qualidade da conta (business.facebook.com/accountquality).",
      "Oriente a pedir revisão; não crie conta nova sem falar com o time.",
    ],
    templateKey: null,
  },
  {
    key: "cliente_sumido",
    label: "Cliente não responde",
    description: "Sem retorno do cliente há dias, travando o próximo passo.",
    playbook: [
      "Mande o follow-up curto.",
      "Depois de 3 dias, avise o CS (risco de cancelamento).",
    ],
    templateKey: "follow_up",
  },
];

export const PROBLEM_TAG_BY_KEY = new Map(PROBLEM_TAGS.map((tag) => [tag.key, tag]));

export type MessageTemplate = {
  key: string;
  label: string;
  stages: JourneyStage[];
  /** Texto com variáveis {{...}}; ver renderTemplate. */
  body: string;
};

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    key: "boas_vindas",
    label: "Apresentação do gestor",
    stages: ["onboarding", "rodando"],
    body:
      "Oi, {{primeiro_nome}}! Aqui é o {{consultor}}, da Automatize. A partir de agora sou eu quem acompanha as campanhas da {{empresa}}. O Fred me passou o que vocês conversaram no onboarding. Qualquer coisa, é só me chamar por aqui. 👊",
  },
  {
    key: "conectar_meta",
    label: "Conectar o Facebook",
    stages: ["onboarding"],
    body:
      "Oi, {{primeiro_nome}}! Para colocar a primeira campanha da {{empresa}} no ar, falta conectar o Facebook de anúncios na Automatize: entre em Marketing › Conectar. Leva 2 minutos. Se preferir, a gente faz junto por chamada.",
  },
  {
    key: "reconectar_facebook",
    label: "Reconectar o Facebook",
    stages: ["onboarding", "rodando", "parado"],
    body:
      "Oi, {{primeiro_nome}}! A conexão do Facebook com a Automatize caiu e, sem ela, não conseguimos acompanhar nem ajustar suas campanhas. Entre em Marketing › Reconectar (1 minuto). Me avisa quando fizer?",
  },
  {
    key: "certificacao_meta",
    label: "Liberação da Meta (não discriminação)",
    stages: ["onboarding", "rodando"],
    body:
      "Oi, {{primeiro_nome}}! Seus anúncios estão prontos, mas a Meta pediu uma confirmação de política (não discriminação) para liberar a conta. É rápido: abra Marketing na Automatize e faça o login com o seu Facebook pessoal no aviso que aparece. Assim que fizer, os anúncios sobem sozinhos.",
  },
  {
    key: "adicionar_pessoas",
    label: "Adicionar a Automatize em Pessoas",
    stages: ["onboarding", "rodando"],
    body:
      "Oi, {{primeiro_nome}}! Para destravar sua conta na Meta, preciso que você adicione a Automatize no seu Business Manager: Configurações do negócio › Pessoas › Adicionar, com o e-mail que te mando em seguida. Pode me mandar um print quando terminar?",
  },
  {
    key: "primeira_campanha",
    label: "Primeira campanha no ar",
    stages: ["onboarding", "rodando"],
    body:
      "{{primeiro_nome}}, a primeira campanha da {{empresa}} está no ar! 🚀 Nos primeiros dias a Meta ainda está aprendendo quem compra, então os números oscilam. Vou acompanhar de perto e te mando um resumo no fim da semana.",
  },
  {
    key: "resumo_semanal",
    label: "Resumo da semana",
    stages: ["rodando"],
    body:
      "Resumo da {{empresa}} nos últimos {{dias}} dias: investimos {{gasto}} e tivemos {{resultado}} ({{custo_label}} de {{custo}}). {{comparacao}} Próximo passo: {{proximo_passo}}",
  },
  {
    key: "campanha_parada",
    label: "Campanha parou de rodar",
    stages: ["parado", "rodando"],
    body:
      "Oi, {{primeiro_nome}}! Notei que as campanhas da {{empresa}} pararam de rodar. Normalmente é saldo ou cartão na Meta. Consegue conferir em Faturamento da Meta? Se estiver tudo certo aí, me avisa que eu investigo.",
  },
  {
    key: "pedir_criativos",
    label: "Pedir criativos novos",
    stages: ["rodando", "parado"],
    body:
      "{{primeiro_nome}}, para melhorar o resultado quero testar criativos novos. Consegue me mandar 3 a 5 fotos ou vídeos curtos (até 15s) dos produtos que mais vendem? Celular na vertical já resolve.",
  },
  {
    key: "verificar_pixel",
    label: "Verificar pixel",
    stages: ["onboarding", "rodando"],
    body:
      "Oi, {{primeiro_nome}}! Para a Meta encontrar quem compra, o pixel precisa registrar as vendas. Você usa alguma plataforma de pedidos (iFood não conta)? Me diz qual que eu te passo onde colar o código.",
  },
  {
    key: "agendar_reuniao",
    label: "Agendar reunião do mês",
    stages: ["rodando", "parado"],
    body:
      "Oi, {{primeiro_nome}}! Bora marcar nossa reunião do mês da {{empresa}}? São 30 minutos para olhar resultados e decidir os próximos testes. Qual dia fica melhor para você esta semana?",
  },
  {
    key: "follow_up",
    label: "Follow-up (sem resposta)",
    stages: ["onboarding", "rodando", "parado"],
    body:
      "Oi, {{primeiro_nome}}, tudo bem? Passando para retomar nossa última conversa — preciso de um retorno seu para seguir com a {{empresa}}. Consegue me responder por aqui?",
  },
];

export const TEMPLATE_BY_KEY = new Map(MESSAGE_TEMPLATES.map((template) => [template.key, template]));

/** Preenche as variáveis com dados do cliente; o que faltar fica entre [colchetes] para editar. */
export function renderTemplate(
  template: MessageTemplate,
  client: WorkspaceClient,
  options: { consultantName?: string | null; nextStep?: string | null } = {},
): string {
  const firstName =
    (client.name ?? "").trim().split(/\s+/)[0] || client.companyName || "tudo bem";
  const kpi = client.perf.kpi;
  const previousCost = client.perf.previousKpi.cost;
  const change = delta(kpi.cost, previousCost);
  const comparison =
    change == null
      ? ""
      : change < 0
        ? `O custo caiu ${formatPct(Math.abs(change), false)} em relação à semana anterior. 📉`
        : `O custo subiu ${formatPct(change, false)} em relação à semana anterior — já estou ajustando.`;
  const vars: Record<string, string> = {
    primeiro_nome: firstName,
    empresa: client.companyName ?? client.displayName,
    consultor: options.consultantName ?? client.consultant.name?.split(" ")[0] ?? "[seu nome]",
    dias: String(client.perf.series.length || 7),
    gasto: formatMoney(client.perf.current.spend, false),
    resultado: `${kpi.count} ${kpi.label.toLowerCase()}`,
    custo_label: kpi.costLabel,
    custo: formatMoney(kpi.cost),
    comparacao: comparison,
    proximo_passo: options.nextStep ?? "[o que você vai fazer]",
  };
  return template.body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `[${key}]`);
}

export type ClientJourney = {
  stage: JourneyStage;
  steps: JourneyStep[];
  /** Primeiro passo obrigatório não concluído (só no onboarding). */
  blocker: JourneyStep | null;
  /** Dias na etapa atual (onboarding: desde o cadastro; parado: desde o último gasto). */
  daysInStage: number | null;
  autoTags: string[];
  manualTags: string[];
  /** Tags ativas (manuais + automáticas não descartadas), na ordem do catálogo. */
  tags: ProblemTag[];
  handoff: WorkspaceState["handoffs"][string] | null;
  /** Rodando, mas fora da meta / sem resultado / com alerta crítico de performance. */
  needsAttention: boolean;
  attentionReasons: string[];
  billingRisk: string | null;
};

function daysSince(date: string | null, now: number): number | null {
  if (!date) return null;
  const diff = now - new Date(date.length === 10 ? `${date}T12:00:00Z` : date).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

export function computeJourney(
  client: WorkspaceClient,
  extras: JourneyExtras | undefined,
  store: WorkspaceState,
  alerts: WorkspaceAlert[],
  goalStatusValue: "sem_meta" | "sem_dados" | "na_meta" | "perto" | "fora",
  /** Relógio da leitura (as telas passam o `now` do servidor, não o do render). */
  now: number = Date.now(),
): ClientJourney {
  const health = client.meta.health;
  const metaOk = health !== "sem_meta" && health !== "token_invalido";
  const certificationOk =
    extras?.certification !== "certification_required" && client.publishHolds === 0;
  const everSpent = Boolean(extras?.firstSpendDate) || client.perf.current.spend > 0;
  const hasCampaign = Boolean(extras?.hasCampaign) || everSpent || client.meta.hasActiveManagedCampaign;
  const handoff = store.handoffs[client.userId] ?? null;
  // Todo grupo de acesso tem acesso válido, menos o inadimplente que já venceu.
  const accessOk =
    client.access !== "inadimplente" ||
    (client.accessUntil != null && new Date(client.accessUntil).getTime() > now);

  const steps: JourneyStep[] = [
    {
      key: "acesso",
      label: client.access === "trial" ? "Trial ativo" : "Acesso ativo",
      done: accessOk,
      hint: "Assinatura ou trial válido.",
    },
    {
      key: "fred",
      label: "Onboarding com o Fred",
      done: Boolean(handoff),
      optional: true,
      hint: "Passagem de bastão registrada: resumo, próximos passos e problemas.",
    },
    {
      key: "meta",
      label: "Facebook conectado",
      done: metaOk,
      hint: health === "token_invalido" ? "Conexão caiu — precisa reconectar." : "Conta de anúncios conectada à Automatize.",
    },
    {
      key: "certificacao",
      label: "Conta liberada pela Meta",
      done: metaOk && certificationOk,
      hint: "Sem erro de não discriminação e sem anúncios retidos.",
    },
    {
      key: "campanha",
      label: "1ª campanha publicada",
      done: hasCampaign,
      hint: "Alguma campanha criada na conta.",
    },
    {
      key: "veiculando",
      label: "Veiculando",
      done: everSpent,
      hint: "A Meta já gastou na conta.",
    },
  ];

  const stage: JourneyStage = !everSpent
    ? "onboarding"
    : client.perf.current.spend > 0
      ? "rodando"
      : "parado";

  const blocker =
    stage === "onboarding" ? steps.find((step) => !step.done && !step.optional) ?? null : null;

  const autoTags: string[] = [];
  if (extras?.certification === "certification_required" || client.publishHolds > 0) autoTags.push("certificacao_meta");
  if (health === "token_invalido") autoTags.push("reconectar_facebook");
  if (health === "sem_meta") autoTags.push("sem_meta");
  if (client.perf.current.spend > 0 && client.perf.kpi.count === 0) autoTags.push("sem_resultado");
  if (alerts.some((alert) => alert.ruleId === "playbook.creative_diagnosis")) autoTags.push("criativos");
  const dismissed = new Set(store.dismissedAutoTags[client.userId] ?? []);
  const activeAuto = autoTags.filter((key) => !dismissed.has(key));
  const manualTags = store.clientTags[client.userId] ?? [];
  const active = new Set([...activeAuto, ...manualTags]);
  const tags = PROBLEM_TAGS.filter((tag) => active.has(tag.key));

  const attentionReasons: string[] = [];
  if (stage === "rodando") {
    if (goalStatusValue === "fora") attentionReasons.push("Fora da meta");
    if (client.perf.kpi.count === 0) attentionReasons.push("Gastando sem resultado");
    const perfCritical = alerts.filter((alert) => alert.family === "playbook" && alert.severity !== "info");
    if (perfCritical.length > 0) attentionReasons.push(`${perfCritical.length} alerta(s) de performance`);
    if (health === "token_invalido") attentionReasons.push("Facebook desconectado");
  }

  const billingAlert = alerts.find((alert) => alert.family === "account" && alert.ruleId !== "account.no_active_campaign");
  const billingRisk =
    client.plan.status === "past_due"
      ? "Pagamento atrasado"
      : client.plan.status === "canceled"
        ? "Assinatura cancelada"
        : billingAlert
          ? billingAlert.ruleTitle
          : null;

  return {
    stage,
    steps,
    blocker,
    daysInStage:
      stage === "onboarding"
        ? daysSince(extras?.signupAt ?? null, now)
        : stage === "parado"
          ? daysSince(extras?.lastSpendDate ?? null, now)
          : daysSince(extras?.firstSpendDate ?? null, now),
    autoTags: activeAuto,
    manualTags,
    tags,
    handoff,
    needsAttention: attentionReasons.length > 0,
    attentionReasons,
    billingRisk,
  };
}
