/**
 * Format a number as currency (BRL)
 */
export function formatCurrency(
  value: string | number | null | undefined
): string {
  if (value === null || value === undefined) {
    return "-";
  }

  const numValue = typeof value === "string" ? parseFloat(value) : value;

  if (isNaN(numValue)) {
    return "-";
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numValue);
}

/**
 * Format a large number with abbreviations (K, M, B)
 */
export function formatNumber(
  value: string | number | null | undefined
): string {
  if (value === null || value === undefined) {
    return "-";
  }

  const numValue = typeof value === "string" ? parseFloat(value) : value;

  if (isNaN(numValue)) {
    return "-";
  }

  if (numValue >= 1_000_000_000) {
    return `${(numValue / 1_000_000_000).toFixed(1)}B`;
  }
  if (numValue >= 1_000_000) {
    return `${(numValue / 1_000_000).toFixed(1)}M`;
  }
  if (numValue >= 1_000) {
    return `${(numValue / 1_000).toFixed(1)}K`;
  }

  return new Intl.NumberFormat("pt-BR").format(numValue);
}

/**
 * Format a percentage value
 */
export function formatPercentage(
  value: string | number | null | undefined
): string {
  if (value === null || value === undefined) {
    return "-";
  }

  const numValue = typeof value === "string" ? parseFloat(value) : value;

  if (isNaN(numValue)) {
    return "-";
  }

  return `${numValue.toFixed(2)}%`;
}

/**
 * Format a date string to locale format
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) {
    return "-";
  }

  try {
    return new Date(dateString).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "-";
  }
}

/**
 * Format date for chart axis (shorter format)
 */
export function formatChartDate(dateString: string | null | undefined): string {
  if (!dateString) {
    return "-";
  }

  try {
    return new Date(dateString).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return "-";
  }
}

/**
 * Get badge variant based on status
 */
export function getStatusBadgeVariant(
  status: string | null | undefined
): "default" | "secondary" | "destructive" | "outline" {
  if (!status) {
    return "outline";
  }

  const normalizedStatus = status.toUpperCase();

  switch (normalizedStatus) {
    case "ACTIVE":
      return "default";
    case "PAUSED":
    case "PENDING_REVIEW":
    case "PENDING":
    case "IN_PROCESS":
      return "secondary";
    case "DELETED":
    case "ARCHIVED":
    case "DISAPPROVED":
      return "destructive";
    default:
      return "outline";
  }
}

/**
 * Translate status to Portuguese
 */
export function translateStatus(status: string | null | undefined): string {
  if (!status) {
    return "N/A";
  }

  const statusMap: Record<string, string> = {
    ACTIVE: "Ativo",
    PAUSED: "Pausado",
    DELETED: "Excluído",
    ARCHIVED: "Arquivado",
    PENDING_REVIEW: "Em análise",
    DISAPPROVED: "Reprovado",
    PREAPPROVED: "Pré-aprovado",
    PENDING_BILLING_INFO: "Aguardando faturamento",
    CAMPAIGN_PAUSED: "Campanha pausada",
    ADSET_PAUSED: "Conjunto pausado",
    IN_PROCESS: "Em processamento",
    WITH_ISSUES: "Com problemas",
  };

  return statusMap[status.toUpperCase()] ?? status;
}

/**
 * Get Portuguese label for optimization goal
 */
export function getOptimizationGoalLabel(
  optimizationGoal: string | null | undefined
): string {
  if (!optimizationGoal) {
    return "N/A";
  }

  const goalMap: Record<string, string> = {
    NONE: "Nenhum",
    APP_INSTALLS: "Instalações de App",
    AD_RECALL_LIFT: "Lembrança do Anúncio",
    ENGAGED_USERS: "Usuários Engajados",
    EVENT_RESPONSES: "Respostas de Eventos",
    IMPRESSIONS: "Impressões",
    LEAD_GENERATION: "Geração de Leads",
    QUALITY_LEAD: "Lead de Qualidade",
    LINK_CLICKS: "Cliques no Link",
    OFFSITE_CONVERSIONS: "Conversões Fora do Site",
    PAGE_LIKES: "Curtidas na Página",
    POST_ENGAGEMENT: "Engajamento no Post",
    QUALITY_CALL: "Chamada de Qualidade",
    REACH: "Alcance",
    LANDING_PAGE_VIEWS: "Visualizações da Página de Destino",
    VISIT_INSTAGRAM_PROFILE: "Visitas ao Perfil do Instagram",
    VALUE: "Valor",
    THRUPLAY: "Reprodução Completa",
    DERIVED_EVENTS: "Eventos Derivados",
    APP_INSTALLS_AND_OFFSITE_CONVERSIONS:
      "Instalações de App e Conversões Fora do Site",
    CONVERSATIONS: "Conversas",
    IN_APP_VALUE: "Valor no App",
    MESSAGING_PURCHASE_CONVERSION: "Conversão de Compra via Mensagem",
    SUBSCRIBERS: "Inscritos",
    REMINDERS_SET: "Lembretes Configurados",
    MEANINGFUL_CALL_ATTEMPT: "Tentativa de Chamada Significativa",
    PROFILE_VISIT: "Visita ao Perfil",
    PROFILE_AND_PAGE_ENGAGEMENT: "Engajamento no Perfil e Página",
    ADVERTISER_SILOED_VALUE: "Valor Isolado do Anunciante",
    AUTOMATIC_OBJECTIVE: "Objetivo Automático",
    MESSAGING_APPOINTMENT_CONVERSION: "Conversão de Agendamento via Mensagem",
  };

  return goalMap[optimizationGoal.toUpperCase()] ?? optimizationGoal;
}

/**
 * Get Portuguese description for optimization goal
 */
export function getOptimizationGoalDescription(
  optimizationGoal: string | null | undefined
): string {
  if (!optimizationGoal) {
    return "Nenhum objetivo de otimização definido.";
  }

  const descriptionMap: Record<string, string> = {
    NONE: "Disponível apenas no modo de leitura para campanhas criadas antes da versão 2.4.",
    APP_INSTALLS:
      "Otimiza para pessoas mais propensas a instalar seu aplicativo.",
    AD_RECALL_LIFT:
      "Otimiza para pessoas mais propensas a lembrar de ter visto seus anúncios.",
    ENGAGED_USERS:
      "Otimiza para pessoas mais propensas a realizar uma ação específica em seu aplicativo.",
    EVENT_RESPONSES:
      "Otimiza para pessoas mais propensas a comparecer ao seu evento.",
    IMPRESSIONS: "Exibe os anúncios o maior número de vezes possível.",
    LEAD_GENERATION:
      "Otimiza para pessoas mais propensas a preencher um formulário de geração de leads.",
    QUALITY_LEAD:
      "Otimiza para pessoas que provavelmente terão uma conversa mais profunda com os anunciantes após o envio do lead.",
    LINK_CLICKS:
      "Otimiza para pessoas mais propensas a clicar no link do anúncio.",
    OFFSITE_CONVERSIONS:
      "Otimiza para pessoas mais propensas a fazer uma conversão no site.",
    PAGE_LIKES: "Otimiza para pessoas mais propensas a curtir sua página.",
    POST_ENGAGEMENT:
      "Otimiza para pessoas mais propensas a se engajar com seu post.",
    QUALITY_CALL:
      "Otimiza para pessoas que provavelmente ligarão para o anunciante.",
    REACH:
      "Otimiza para alcançar o maior número de usuários únicos para cada dia ou intervalo especificado em frequency_control_specs.",
    LANDING_PAGE_VIEWS:
      "Otimiza para pessoas que têm maior probabilidade de clicar e carregar sua página de destino escolhida.",
    VISIT_INSTAGRAM_PROFILE:
      "Otimiza para visitas ao perfil do Instagram do anunciante.",
    VALUE:
      "Otimiza para o valor total máximo de compra dentro da janela de atribuição especificada.",
    THRUPLAY:
      "Otimiza a entrega de seus anúncios para pessoas que têm maior probabilidade de reproduzir seu anúncio até o final ou reproduzi-lo por pelo menos 15 segundos.",
    DERIVED_EVENTS:
      "Otimiza para retenção, que alcança pessoas que têm maior probabilidade de retornar ao aplicativo e abri-lo novamente durante um período de tempo determinado após a instalação.",
    APP_INSTALLS_AND_OFFSITE_CONVERSIONS:
      "Otimiza para pessoas mais propensas a instalar seu aplicativo e fazer uma conversão em seu site.",
    CONVERSATIONS:
      "Direciona anúncios para pessoas mais propensas a ter uma conversa com a empresa.",
    IN_APP_VALUE: "Otimiza para valor dentro do aplicativo.",
    MESSAGING_PURCHASE_CONVERSION:
      "Otimiza para conversões de compra através de mensagens.",
    SUBSCRIBERS: "Otimiza para pessoas mais propensas a se inscrever.",
    REMINDERS_SET:
      "Otimiza para pessoas mais propensas a configurar lembretes.",
    MEANINGFUL_CALL_ATTEMPT:
      "Otimiza para tentativas de chamada significativas.",
    PROFILE_VISIT: "Otimiza para visitas ao perfil.",
    PROFILE_AND_PAGE_ENGAGEMENT:
      "Otimiza para engajamento no perfil e na página.",
    ADVERTISER_SILOED_VALUE:
      "Otimiza para valor isolado específico do anunciante.",
    AUTOMATIC_OBJECTIVE:
      "Otimiza automaticamente com base no objetivo da campanha.",
    MESSAGING_APPOINTMENT_CONVERSION:
      "Otimiza para conversões de agendamento através de mensagens.",
  };

  return (
    descriptionMap[optimizationGoal.toUpperCase()] ??
    `Objetivo de otimização: ${optimizationGoal}`
  );
}
