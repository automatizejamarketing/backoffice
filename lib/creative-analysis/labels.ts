export const CREATIVE_DIMENSION_LABELS: Record<string, string> = {
  hook: "Gancho",
  pacing: "Ritmo",
  productVisibility: "Visibilidade do produto",
  offerClarity: "Clareza da oferta",
  proof: "Prova social",
  cta: "Chamada para ação",
  textReadability: "Legibilidade do texto",
  audio: "Áudio",
  duration: "Duração",
  format: "Formato",
};

export const CREATIVE_CONFIDENCE_LABELS: Record<string, string> = {
  high: "alta",
  medium: "média",
  low: "baixa",
};

export function creativeConfidenceLabel(value: string): string {
  return CREATIVE_CONFIDENCE_LABELS[value] ?? value;
}

export function creativeDimensionLabel(dimension: string): string {
  if (CREATIVE_DIMENSION_LABELS[dimension]) {
    return CREATIVE_DIMENSION_LABELS[dimension];
  }
  return dimension
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

/**
 * Motivos persistidos em `error_message` quando o gate não manda o anúncio
 * para o modelo (`status = skipped`) ou o job falha.
 */
export const CREATIVE_SKIP_REASON_LABELS: Record<string, string> = {
  metrics_do_not_underperform:
    "Não está pior que os anúncios irmãos o bastante para analisar",
  no_fair_comparator: "Não há irmão comparável no mesmo recorte",
  insufficient_sample:
    "Amostra insuficiente (gasto ou impressões nos últimos 7 dias)",
  is_ranking_winner:
    "A peça é vencedora do ranking — não entra como hipótese de problema",
  not_food_service: "Fora do recorte de food service",
  not_sales_objective: "Campanha não é de vendas",
  not_active: "Anúncio não está ativo",
  incomplete_coverage: "Cobertura de tracking incompleta",
  connection_unavailable: "Conexão Meta indisponível",
  learning_limited:
    "Conta em aprendizado limitado — injusto culpar a peça",
  delivery_issues: "Problemas de veiculação — injusto culpar a peça",
  recent_config_change: "Mudança recente de configuração",
  not_allowlisted: "Conta ou usuário fora da allowlist",
  no_ready_ranking_rubric: "Não há rubric pronta do Ranking do Dia",
  stale_pending_expired:
    "A análise ficou presa em processamento e expirou",
  no_tracking_snapshot: "Sem snapshot de tracking no momento da análise",
  ad_not_found: "Anúncio não encontrado no snapshot",
  forced_control: "Controle forçado (gate contornado)",
  processing_failed: "Falha no processamento",
  missing_or_disconnected: "Conta desconectada ou sem dados",
  analysis_disabled: "Análise desligada neste ambiente",
  global_budget_exhausted: "Orçamento diário de análises esgotado",
  missing_after_complete: "O resultado sumiu depois de processar",
};

export function creativeSkipReasonLabel(code: string): string {
  return CREATIVE_SKIP_REASON_LABELS[code] ?? code.replace(/[_-]+/g, " ");
}
