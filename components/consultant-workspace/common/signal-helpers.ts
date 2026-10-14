/**
 * Ajudantes puros dos sinais da carteira: chaves dos sinais calculados,
 * o que está tratado/adiado agora e a limpeza de jargão dos textos dos
 * alertas. Sem React.
 */
import type { WorkspaceAlert, WorkspaceAlertAction } from "@/lib/consultant-workspace/types";

export type Severity = "critical" | "warning" | "info";

/** Sinais calculados dos dados (não vêm de `performance_insights`). */
export type SyntheticKind =
  | "meta"
  | "sem_entrega"
  | "fora_da_meta"
  | "retido"
  | "onboarding"
  | "sem_meta_definida"
  | "sem_contato"
  | "ritmo"
  | "perto_da_meta";

export const SYNTHETIC_TITLE: Record<SyntheticKind, string> = {
  meta: "Conexão com a Meta com problema",
  sem_entrega: "Parou de entregar",
  fora_da_meta: "Fora da meta combinada",
  retido: "Publicação retida",
  onboarding: "Onboarding travado",
  sem_meta_definida: "Sem meta combinada",
  sem_contato: "Sem contato registrado",
  ritmo: "Verba fora do ritmo combinado",
  perto_da_meta: "Perto de sair da meta",
};

/** Sinal calculado concluído volta depois de 3 dias se continuar valendo. */
const SYNTHETIC_DONE_TTL_MS = 3 * 86_400_000;

export function syntheticKey(kind: SyntheticKind, userId: string) {
  return `sinal:${kind}:${userId}`;
}

export function isSyntheticKey(key: string) {
  return key.startsWith("sinal:");
}

export function syntheticKindOf(key: string): SyntheticKind | null {
  if (!isSyntheticKey(key)) return null;
  const kind = key.split(":")[1] as SyntheticKind;
  return kind in SYNTHETIC_TITLE ? kind : null;
}

export function syntheticUserOf(key: string): string | null {
  if (!isSyntheticKey(key)) return null;
  return key.split(":")[2] ?? null;
}

/** Está tratado/adiado agora? (vale para alertas reais e sinais calculados) */
export function isHidden(key: string, action: WorkspaceAlertAction | undefined, now = Date.now()) {
  if (!action) return false;
  if (action.status === "snoozed") {
    return !!action.snoozeUntil && new Date(action.snoozeUntil).getTime() > now;
  }
  if (isSyntheticKey(key)) return new Date(action.at).getTime() > now - SYNTHETIC_DONE_TTL_MS;
  return true;
}

export function isSnoozed(action: WorkspaceAlertAction | undefined, now = Date.now()) {
  return action?.status === "snoozed" && !!action.snoozeUntil && new Date(action.snoozeUntil).getTime() > now;
}

/**
 * Tira jargão do texto dos alertas: nomes automáticos "[AM][VENDAS][FS][data]",
 * ids numéricos, status em inglês e ponto decimal.
 */
export function humanize(text: string): string {
  if (!text) return text;
  return text
    .replace(/\[AM\]((?:\s*\[[^\]]*\])*)/g, (_match, tags: string) => {
      const parts = [...tags.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1].trim());
      const ignore = new Set(["FS", "MAT", "AM", "CBO", "ABO", "CONSULTOR"]);
      const goal = parts.find((p) => /^[A-ZÇÃÕÉÍÁÊ ]{3,}$/.test(p) && !ignore.has(p));
      let when = "";
      for (const part of parts) {
        const iso = part.match(/^\d{4}-(\d{2})-(\d{2})/);
        const short = part.match(/^(\d{2})[.,/](\d{2})$/);
        if (iso) when = ` de ${iso[2]}/${iso[1]}`;
        else if (short) when = ` de ${short[1]}/${short[2]}`;
        if (when) break;
      }
      const label = goal ? goal.charAt(0) + goal.slice(1).toLowerCase() : "";
      return `automática${label ? ` de ${label}` : ""}${when}`;
    })
    .replace(/"\d{12,}"\s*/g, "")
    .replace(/\bACTIVE\b/g, "ativa")
    .replace(/\bPAUSED\b/g, "pausada")
    .replace(/\bWITH_ISSUES\b/g, "com problemas")
    .replace(/\bpast_due\b/g, "em atraso")
    .replace(/Assinatura Stripe/g, "Assinatura no cartão")
    .replace(/\bCBO\b\s*-?\s*/g, "")
    .replace(/(\d)\.(\d{1,2})\b/g, "$1,$2");
}

export function humanizeName(name: string | null | undefined): string {
  if (!name) return "Sem nome";
  const value = humanize(name).trim();
  return value.startsWith("automática") ? `Campanha ${value}` : value;
}

/** Nome da campanha/conjunto/anúncio do alerta, sem ids crus; null no nível da conta. */
export function entityLabel({ alert }: { alert?: Pick<WorkspaceAlert, "entityLevel" | "entityName"> }): string | null {
  if (!alert || !["campaign", "adset", "ad"].includes(alert.entityLevel)) return null;
  const name = alert.entityName?.trim();
  const kind = alert.entityLevel === "campaign" ? "Campanha" : alert.entityLevel === "adset" ? "Conjunto" : "Anúncio";
  if (!name || /^\d{8,}$/.test(name)) return `${kind} sem nome`;
  return humanizeName(name);
}

export function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function formatDateShort(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(iso));
}
