import {
  PLAYBOOK_RULE_ROAS_SCALE,
  PLAYBOOK_RULE_STALLED,
  PLAYBOOK_SCALE_BUDGET_FACTOR,
} from "./constants";

export const PLAYBOOK_APPLY_ACTION_IDS = [
  "reactivate",
  "archive",
  "scale_budget",
  "duplicate",
] as const;

export type PlaybookApplyActionId = (typeof PLAYBOOK_APPLY_ACTION_IDS)[number];

export type PlaybookApplyActionDef = {
  id: PlaybookApplyActionId;
  label: string;
  confirmTitle: string;
  confirmDescription: string;
  variant: "default" | "outline" | "destructive";
};

const ACTION_DEFS: Record<PlaybookApplyActionId, PlaybookApplyActionDef> = {
  reactivate: {
    id: "reactivate",
    label: "Reativar campanha",
    confirmTitle: "Reativar esta campanha na Meta?",
    confirmDescription:
      "A campanha volta a veicular com a configuração atual. Pausas frequentes resetam o aprendizado — só reative se for manter ligada.",
    variant: "default",
  },
  archive: {
    id: "archive",
    label: "Arquivar campanha",
    confirmTitle: "Arquivar esta campanha na Meta?",
    confirmDescription:
      "A campanha para de veicular e sai da lista ativa. Use isto para encerrar de vez e redistribuir a verba.",
    variant: "destructive",
  },
  scale_budget: {
    id: "scale_budget",
    label: "Aumentar orçamento 20%",
    confirmTitle: "Aumentar o orçamento em 20% na Meta?",
    confirmDescription:
      "O aumento segue o modo atual da campanha (CBO na campanha, ABO em cada conjunto). 20% é o passo usual para não quebrar o aprendizado.",
    variant: "default",
  },
  duplicate: {
    id: "duplicate",
    label: "Duplicar campanha",
    confirmTitle: "Duplicar esta campanha na Meta?",
    confirmDescription:
      "Cria uma cópia (geralmente pausada) preservando conjuntos e anúncios, para estender o voo sem mexer na campanha encerrada.",
    variant: "default",
  },
};

export function isPlaybookApplyActionId(
  value: unknown,
): value is PlaybookApplyActionId {
  return (
    typeof value === "string" &&
    (PLAYBOOK_APPLY_ACTION_IDS as readonly string[]).includes(value)
  );
}

function endedCampaignStatus(metrics: Record<string, unknown> | null): boolean {
  const status = String(metrics?.effectiveStatus ?? "").toUpperCase();
  return status === "COMPLETED" || status === "ARCHIVED";
}

/**
 * Concrete Meta mutations this insight can run from the backoffice.
 * Diagnostic rules (ROAS baixo, CPA, sem entrega) stay review-only.
 */
export function listPlaybookApplyActions(insight: {
  ruleId: string;
  metrics?: Record<string, unknown> | null;
}): PlaybookApplyActionDef[] {
  if (insight.ruleId === PLAYBOOK_RULE_STALLED) {
    return [ACTION_DEFS.reactivate, ACTION_DEFS.archive];
  }
  if (insight.ruleId === PLAYBOOK_RULE_ROAS_SCALE) {
    if (endedCampaignStatus(insight.metrics ?? null)) {
      return [ACTION_DEFS.duplicate];
    }
    return [ACTION_DEFS.scale_budget];
  }
  return [];
}

export function isPlaybookApplyActionAllowed(
  insight: { ruleId: string; metrics?: Record<string, unknown> | null },
  actionId: PlaybookApplyActionId,
): boolean {
  return listPlaybookApplyActions(insight).some((action) => action.id === actionId);
}

export function playbookApplyChangeNote(
  actionId: PlaybookApplyActionId,
  entityName: string | null | undefined,
): string {
  const name = entityName?.trim() ? ` "${entityName.trim()}"` : "";
  switch (actionId) {
    case "reactivate":
      return `Playbook: reativar campanha parada${name}`;
    case "archive":
      return `Playbook: arquivar campanha parada${name}`;
    case "scale_budget":
      return `Playbook: aumentar orçamento 20% (ROAS validado)${name}`;
    case "duplicate":
      return `Playbook: duplicar campanha com ROAS validado${name}`;
  }
}

export function hasPositiveMinorUnits(
  value: string | number | null | undefined,
): boolean {
  if (value == null || value === "") return false;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

/** Scale a Meta minor-units budget string (cents). At least +1 cent. */
export function scaleMinorUnits(
  current: string | number,
  factor = PLAYBOOK_SCALE_BUDGET_FACTOR,
): string | null {
  const n = typeof current === "number" ? current : Number(current);
  if (!Number.isFinite(n) || n <= 0) return null;
  const rounded = Math.round(n);
  const next = Math.round(n * factor);
  return String(Math.max(next, rounded + 1));
}

export function formatMinorUnitsBRL(minor: string | number): string {
  const n = typeof minor === "number" ? minor : Number(minor);
  if (!Number.isFinite(n)) return "—";
  return `R$ ${(n / 100).toFixed(2)}`;
}
