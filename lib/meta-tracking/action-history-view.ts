/**
 * O histórico unificado de ações, pronto para leitura (§9 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Costura pura entre o stream de `meta_tracking_change_events` e a tela: traduz
 * origem, autor, motivo e o diff pré-computado para o vocabulário de quem
 * opera. Substitui a leitura fragmentada dos edit logs legados — lá cada tabela
 * tinha o seu formato e as mudanças feitas fora da plataforma não apareciam.
 *
 * Duas coisas justificam este módulo existir em vez de a formatação morar no
 * componente:
 *
 * 1. **Dinheiro.** `daily_budget` e companhia chegam da Meta em unidades
 *    MENORES; `spend`, dos insights, em unidades maiores. Errar isso mostra um
 *    orçamento cem vezes maior na tela, e a regra precisa de teste.
 * 2. **A mesma ação chega por duas consultas.** A campanha guarda
 *    `campaign_id` nulo e os filhos o carregam, então "o histórico desta
 *    campanha" é a união de dois conjuntos — e união pede ordem e deduplicação.
 *
 * Sem I/O, sem React.
 */

import {
  APPLY_FAILED_FIELD,
  isAppliedToMeta,
} from "@/lib/meta-tracking/internal-change-event";
import type {
  MetaTrackingChangedFields,
  MetaTrackingChangeKind,
  MetaTrackingChangeSource,
  MetaTrackingEntityLevel,
} from "@/lib/db/schema";

/** O que a tela precisa de uma linha do stream — um subconjunto do modelo. */
export type ActionHistoryEvent = {
  id: string;
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  entityName: string | null;
  campaignId: string | null;
  adsetId: string | null;
  changeKind: MetaTrackingChangeKind;
  changedFields: MetaTrackingChangedFields;
  source: MetaTrackingChangeSource;
  actorEmail: string | null;
  actorNameMeta: string | null;
  note: string | null;
  occurredAt: Date;
  detectedAt: Date;
  legacyEditLogTable: string | null;
  legacyEditLogId: string | null;
};

export type ActionFieldChange = {
  field: string;
  label: string;
  from: string;
  to: string;
};

export type ActionHistoryItem = {
  id: string;
  entityLevel: MetaTrackingEntityLevel;
  entityLevelLabel: string;
  entityId: string;
  entityName: string | null;
  changeKind: MetaTrackingChangeKind;
  kindLabel: string;
  source: MetaTrackingChangeSource;
  sourceLabel: string;
  /** Email de quem agiu pela plataforma, nome do audit trail da Meta, ou ambos. */
  actorLabel: string | null;
  note: string | null;
  occurredAt: Date;
  detectedAt: Date;
  /** `occurred_at` só é exato quando alguém o declarou; senão é a detecção. */
  isExactTime: boolean;
  appliedToMeta: boolean;
  failureMessage: string | null;
  changes: ActionFieldChange[];
  /** Existe um edit log legado apontado por este evento (dual-write). */
  hasLegacyBridge: boolean;
};

const KIND_LABELS: Record<MetaTrackingChangeKind, string> = {
  created: "Criação",
  config_change: "Alteração de configuração",
  status_transition: "Mudança de status",
  archived: "Arquivamento",
  deleted_detected: "Remoção detectada",
};

const SOURCE_LABELS: Record<MetaTrackingChangeSource, string> = {
  backoffice_admin: "Backoffice",
  frontend_user: "Painel do cliente",
  external_detected: "Gerenciador de Anúncios",
  system: "Sistema",
};

const ENTITY_LEVEL_LABELS: Record<MetaTrackingEntityLevel, string> = {
  campaign: "Campanha",
  adset: "Conjunto",
  ad: "Anúncio",
};

/**
 * Rótulos no vocabulário do gestor para as chaves da Graph API que o diff usa.
 * Campo fora desta lista aparece com o nome cru — é honesto e não esconde a
 * mudança.
 */
const FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  status: "Status",
  effective_status: "Estado efetivo",
  objective: "Objetivo",
  buying_type: "Tipo de compra",
  bid_strategy: "Estratégia de lance",
  daily_budget: "Orçamento diário",
  lifetime_budget: "Orçamento total",
  spend_cap: "Limite de gasto",
  budget_remaining: "Orçamento restante",
  bid_amount: "Lance",
  budget_mode: "Modo de orçamento",
  is_adset_budget_sharing_enabled: "Compartilhamento de orçamento",
  special_ad_categories: "Categorias especiais",
  smart_promotion_type: "Tipo de promoção inteligente",
  advantage_state: "Estado Advantage+",
  optimization_goal: "Meta de otimização",
  billing_event: "Evento de cobrança",
  destination_type: "Destino",
  start_time: "Início",
  end_time: "Término",
  is_dynamic_creative: "Criativo dinâmico",
  targeting: "Segmentação",
  promoted_object: "Objeto promovido",
  attribution_spec: "Janela de atribuição",
  frequency_control_specs: "Controle de frequência",
  pacing_type: "Ritmo de entrega",
  dsa_beneficiary: "Beneficiário (DSA)",
  dsa_payor: "Pagador (DSA)",
  creative_id: "Criativo",
  conversion_domain: "Domínio de conversão",
  tracking_specs: "Rastreamento",
};

/**
 * Vêm da Meta em unidades MENORES (centavos). O `spend` dos insights vem em
 * unidades maiores — nunca compare os dois sem converter (aviso 6 do ticket 01).
 */
const MINOR_UNIT_MONEY_FIELDS: ReadonlySet<string> = new Set([
  "daily_budget",
  "lifetime_budget",
  "spend_cap",
  "budget_remaining",
  "bid_amount",
]);

const EMPTY_VALUE = "—";
const MAX_VALUE_LENGTH = 120;

function truncate(value: string): string {
  return value.length > MAX_VALUE_LENGTH
    ? `${value.slice(0, MAX_VALUE_LENGTH)}…`
    : value;
}

function formatMinorUnitMoney(value: unknown, currency: string): string | null {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(amount)) return null;

  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount / 100);
  } catch {
    // Moeda desconhecida pela plataforma: melhor o número certo sem símbolo do
    // que uma exceção derrubando o histórico inteiro.
    return (amount / 100).toFixed(2);
  }
}

export function formatChangeValue(
  field: string,
  value: unknown,
  currency: string,
): string {
  if (value === null || value === undefined || value === "") return EMPTY_VALUE;
  if (typeof value === "boolean") return value ? "sim" : "não";

  if (MINOR_UNIT_MONEY_FIELDS.has(field)) {
    const money = formatMinorUnitMoney(value, currency);
    if (money !== null) return money;
  }

  if (typeof value === "string") return truncate(value);
  if (typeof value === "number") return truncate(String(value));

  try {
    return truncate(JSON.stringify(value) ?? EMPTY_VALUE);
  } catch {
    return EMPTY_VALUE;
  }
}

const DEFAULT_CURRENCY = "BRL";

function normalizeCurrency(currency: string | null | undefined): string {
  const code = currency?.trim().toUpperCase();
  return code && /^[A-Z]{3}$/.test(code) ? code : DEFAULT_CURRENCY;
}

function actorLabelOf(event: ActionHistoryEvent): string | null {
  if (event.actorEmail && event.actorNameMeta) {
    return `${event.actorEmail} (${event.actorNameMeta})`;
  }
  return event.actorEmail ?? event.actorNameMeta ?? null;
}

function failureMessageOf(
  changedFields: MetaTrackingChangedFields,
): string | null {
  const marker = changedFields[APPLY_FAILED_FIELD];
  if (!marker) return null;
  return typeof marker.new === "string" && marker.new.trim() !== ""
    ? marker.new
    : "A Meta recusou a alteração.";
}

/**
 * Uma escrita interna sabe a hora exata: quem agiu foi a própria plataforma.
 * Uma mudança detectada só pelo diff sabe quando foi *vista* — a menos que o
 * audit trail da Meta tenha refinado o carimbo, o que separa os dois momentos.
 */
function hasExactTime(event: ActionHistoryEvent): boolean {
  if (event.source !== "external_detected") return true;
  return event.occurredAt.getTime() !== event.detectedAt.getTime();
}

/** Mais recente primeiro; o id desempata ações simultâneas de forma estável. */
function byMostRecent<T extends { id: string; occurredAt: Date }>(
  a: T,
  b: T,
): number {
  const delta = b.occurredAt.getTime() - a.occurredAt.getTime();
  return delta !== 0 ? delta : b.id.localeCompare(a.id);
}

export type ActionHistoryOptions = {
  /** Moeda da conta de anúncio; os orçamentos estão nela. */
  currency?: string | null;
};

export function buildActionHistory(
  events: readonly ActionHistoryEvent[],
  options: ActionHistoryOptions = {},
): ActionHistoryItem[] {
  const currency = normalizeCurrency(options.currency);

  return [...events].sort(byMostRecent).map((event) => {
    const changes: ActionFieldChange[] = Object.entries(event.changedFields)
      .filter(([field]) => field !== APPLY_FAILED_FIELD)
      .map(([field, change]) => ({
        field,
        label: FIELD_LABELS[field] ?? field,
        from: formatChangeValue(field, change?.old, currency),
        to: formatChangeValue(field, change?.new, currency),
      }));

    return {
      id: event.id,
      entityLevel: event.entityLevel,
      entityLevelLabel: ENTITY_LEVEL_LABELS[event.entityLevel],
      entityId: event.entityId,
      entityName: event.entityName,
      changeKind: event.changeKind,
      kindLabel: KIND_LABELS[event.changeKind] ?? event.changeKind,
      source: event.source,
      sourceLabel: SOURCE_LABELS[event.source] ?? event.source,
      actorLabel: actorLabelOf(event),
      note: event.note,
      occurredAt: event.occurredAt,
      detectedAt: event.detectedAt,
      isExactTime: hasExactTime(event),
      appliedToMeta: isAppliedToMeta(event.changedFields),
      failureMessage: failureMessageOf(event.changedFields),
      changes,
      hasLegacyBridge: Boolean(
        event.legacyEditLogTable && event.legacyEditLogId,
      ),
    };
  });
}

/**
 * A mesma vista com os instantes em ISO — o que atravessa a rede entre a rota e
 * o painel. Definida aqui, e não nos dois lados, para que não possa divergir.
 */
export type SerializedActionHistoryItem = Omit<
  ActionHistoryItem,
  "occurredAt" | "detectedAt"
> & {
  occurredAt: string;
  detectedAt: string;
};

/** O contrato da rota de histórico, compartilhado com o painel que a consome. */
export type TrackingHistoryResponse = {
  actions: SerializedActionHistoryItem[];
  /** Moeda da conta de anúncio; `null` quando a conta nunca foi coletada. */
  currency: string | null;
};

export function serializeActionHistory(
  items: readonly ActionHistoryItem[],
): SerializedActionHistoryItem[] {
  return items.map((item) => ({
    ...item,
    occurredAt: item.occurredAt.toISOString(),
    detectedAt: item.detectedAt.toISOString(),
  }));
}

/**
 * A união dos conjuntos que compõem o histórico de um escopo — a entidade em si
 * e a descendência dela, que chegam por consultas separadas porque o nível da
 * própria entidade guarda `campaign_id`/`adset_id` nulos.
 *
 * O limite corta pelo fim (as mais antigas), para que a leitura comece sempre
 * pelo que acabou de acontecer.
 */
export function mergeActionStreams<T extends { id: string; occurredAt: Date }>(
  streams: ReadonlyArray<readonly T[]>,
  limit?: number,
): T[] {
  const byId = new Map<string, T>();
  for (const stream of streams) {
    for (const event of stream) {
      if (!byId.has(event.id)) byId.set(event.id, event);
    }
  }

  const merged = [...byId.values()].sort(byMostRecent);

  return limit && limit > 0 ? merged.slice(0, limit) : merged;
}
