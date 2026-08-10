/**
 * Configuração de uma entidade Meta virando VERSÃO: normalização, hash e
 * projeção nas colunas tipadas (§4.1 e §5.3 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Puro por decisão de arquitetura: nada aqui importa banco nem faz fetch. É a
 * metade "o que é uma configuração" da costura do delta — a outra metade,
 * "o que mudou desde ontem", vive em `compute-tracking-delta.ts`.
 *
 * A pergunta que o módulo responde é uma só: **duas observações da mesma
 * entidade são a mesma configuração?** O hash é a resposta barata, e o que ele
 * ignora é a decisão de projeto mais importante do arquivo — ver
 * `VOLATILE_CONFIG_FIELDS` e `NON_CONFIG_FIELDS`.
 */

import { createHash } from "node:crypto";

import type {
  MetaTrackingBudgetMode,
  MetaTrackingEntityLevel,
} from "@/lib/db/schema";

/**
 * Campos que a Meta devolve junto da configuração e que MUDAM SOZINHOS. Ficam
 * fora do hash (mas são gravados na versão — o schema tem coluna para cada um):
 * o estado efetivo cai por cascata quando o pai pausa, o orçamento restante
 * muda a cada gasto, a fase de aprendizado anda sem ninguém tocar em nada e o
 * `updated_time` sobe com qualquer um desses.
 *
 * Se entrassem no hash, toda entidade ganharia versão nova todo dia e a
 * pergunta "o que estava valendo quando o resultado mudou?" se perderia no
 * ruído. Transição de estado efetivo vira EVENTO, não versão.
 */
export const VOLATILE_CONFIG_FIELDS = [
  "effective_status",
  "budget_remaining",
  "learning_stage_info",
  "issues_info",
  "updated_time",
  "last_budget_toggling_time",
] as const;

/**
 * Blocos que vêm na mesma resposta mas não são configuração DESTA entidade:
 * edges de filhos (a listagem diária pede `adsets{…}`/`ads{…}` aninhados) e
 * métricas embutidas.
 *
 * A exclusão do edge de filhos é o que impede a falha mais cara possível aqui:
 * um filho pausado mudaria o hash do PAI, e o histórico de configuração da
 * campanha passaria a registrar versão nova toda vez que alguém mexesse em um
 * anúncio. `ad_review_feedback` entra na lista pelo mesmo motivo dos voláteis
 * (é revisão da Meta, não configuração), mas sem coluna própria — segue
 * preservado no `config` jsonb integral, como todo o resto.
 */
export const NON_CONFIG_FIELDS = [
  "adsets",
  "ads",
  "insights",
  "recommendations",
  "ad_review_feedback",
] as const;

const EXCLUDED_FROM_HASH = new Set<string>([
  ...VOLATILE_CONFIG_FIELDS,
  ...NON_CONFIG_FIELDS,
]);

/**
 * Configuração comparável: os campos estáveis da resposta da Graph API, com as
 * chaves de todo objeto aninhado em ordem determinística.
 */
export type NormalizedConfig = Record<string, unknown>;

/**
 * Ordena chaves de objeto recursivamente. A ordem de ARRAY é preservada: em
 * `attribution_spec`, `pacing_type` ou `publisher_platforms` a posição carrega
 * significado (ou pelo menos pode carregar), e ordenar seria inventar
 * equivalência que a Meta não prometeu.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue;
    canonical[key] = canonicalize(source[key]);
  }
  return canonical;
}

/**
 * A resposta crua da Graph API reduzida ao que, mudando, significa que alguém
 * mudou a configuração. Voláteis e edges fora; chaves ordenadas.
 */
export function normalizeTrackedConfig(
  raw: Record<string, unknown>,
): NormalizedConfig {
  const normalized: NormalizedConfig = {};
  for (const key of Object.keys(raw).sort()) {
    if (EXCLUDED_FROM_HASH.has(key)) continue;
    if (raw[key] === undefined) continue;
    normalized[key] = canonicalize(raw[key]);
  }
  return normalized;
}

/**
 * sha256 hex da configuração normalizada — o `config_hash` da versão.
 *
 * Recebe a NORMALIZADA de propósito: quem chama tem de ter passado por
 * `normalizeTrackedConfig` antes, e o hash de uma resposta crua nunca é
 * calculado por acidente.
 */
export function hashTrackedConfig(normalized: NormalizedConfig): string {
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

/**
 * As colunas tipadas ESTÁVEIS de `meta_tracking_config_versions` — o que a
 * consulta quente filtra e agrega sem abrir o JSON. Nulas quando não se aplicam
 * ao nível: a tabela é uma só para os três.
 *
 * DINHEIRO em `dailyBudget`, `lifetimeBudget`, `spendCap` e `bidAmount` está em
 * unidades MENORES da moeda da conta (centavos), exatamente como a Meta
 * devolve — `spend` dos insights vem em unidades MAIORES. Nunca some os dois
 * sem converter.
 */
export type TrackedVersionColumns = {
  entityName: string | null;
  campaignId: string | null;
  adsetId: string | null;
  configuredStatus: string | null;
  createdTimeMeta: Date | null;

  // Campanha
  objective: string | null;
  buyingType: string | null;
  bidStrategy: string | null;
  spendCap: string | null;
  specialAdCategories: unknown;
  smartPromotionType: string | null;
  advantageState: string | null;
  isAdsetBudgetSharingEnabled: boolean | null;
  budgetMode: MetaTrackingBudgetMode | null;

  // Campanha ou conjunto
  dailyBudget: string | null;
  lifetimeBudget: string | null;
  startTime: Date | null;
  endTime: Date | null;

  // Conjunto
  optimizationGoal: string | null;
  billingEvent: string | null;
  bidAmount: string | null;
  destinationType: string | null;
  isDynamicCreative: boolean | null;
  targeting: unknown;
  promotedObject: unknown;
  attributionSpec: unknown;
  frequencyControlSpecs: unknown;
  pacingType: unknown;
  dsaBeneficiary: string | null;
  dsaPayor: string | null;

  // Anúncio
  creativeId: string | null;
  conversionDomain: string | null;
  trackingSpecs: unknown;
};

/** A metade que muda sozinha — gravada na versão, fora do hash. */
export type TrackedVolatileColumns = {
  effectiveStatus: string | null;
  budgetRemaining: string | null;
  learningStageInfo: unknown;
  issuesInfo: unknown;
  updatedTimeMeta: Date | null;
  lastBudgetTogglingTime: Date | null;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Numérico como a Meta manda (string ou número), preservando o zero. */
function numeric(value: unknown): string | null {
  return typeof value === "number" ? String(value) : text(value);
}

/**
 * Valor monetário CONFIGURADO, em unidades menores. `"0"` é como a Meta diz
 * "não tem orçamento AQUI" (o dinheiro está no outro nível ou no outro campo) —
 * ninguém configura orçamento zero —, e vira NULL para que a coluna signifique
 * "não se aplica" em vez de "zero real". Quantidade OBSERVADA (`budget_remaining`)
 * não passa por aqui: lá o zero é informação, não ausência.
 *
 * O sentinela `"92233720368547758"` de `spend_cap` ("sem limite") é preservado
 * cru de propósito: é magia documentada da Meta, não zero.
 */
function configuredMoney(value: unknown): string | null {
  const raw = numeric(value);
  return raw === "0" ? null : raw;
}

function instant(value: unknown): Date | null {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function flag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function jsonOrNull(value: unknown): unknown {
  return value === undefined || value === null ? null : value;
}

/**
 * Projeta a resposta crua nas colunas tipadas do nível. O `config` jsonb
 * integral continua guardando tudo — esta projeção existe só para a consulta
 * quente não precisar abri-lo.
 */
export function projectVersionColumns(
  level: MetaTrackingEntityLevel,
  raw: Record<string, unknown>,
): TrackedVersionColumns {
  const isCampaign = level === "campaign";
  const isAdset = level === "adset";
  const isAd = level === "ad";

  const dailyBudget = isAd ? null : configuredMoney(raw.daily_budget);
  const lifetimeBudget = isAd ? null : configuredMoney(raw.lifetime_budget);

  return {
    entityName: text(raw.name),
    // Hierarquia desnormalizada para filtrar sem join; nula no próprio nível.
    campaignId: isCampaign ? null : text(raw.campaign_id),
    adsetId: isAd ? text(raw.adset_id) : null,
    configuredStatus: text(raw.status),
    createdTimeMeta: instant(raw.created_time),

    objective: isCampaign ? text(raw.objective) : null,
    buyingType: isCampaign ? text(raw.buying_type) : null,
    // A Meta expõe estratégia de lance na campanha E no conjunto; a coluna é
    // uma só e vale para os dois.
    bidStrategy: isAd ? null : text(raw.bid_strategy),
    spendCap: isCampaign ? configuredMoney(raw.spend_cap) : null,
    specialAdCategories: isCampaign
      ? jsonOrNull(raw.special_ad_categories)
      : null,
    smartPromotionType: isCampaign ? text(raw.smart_promotion_type) : null,
    advantageState: isCampaign ? text(raw.advantage_state) : null,
    isAdsetBudgetSharingEnabled: isCampaign
      ? flag(raw.is_adset_budget_sharing_enabled)
      : null,
    // CBO é orçamento NA campanha; sem orçamento próprio, o dinheiro está nos
    // conjuntos (ABO). A Meta não devolve o modo — devolve onde está o dinheiro.
    budgetMode: isCampaign
      ? dailyBudget !== null || lifetimeBudget !== null
        ? "CBO"
        : "ABO"
      : null,

    dailyBudget,
    lifetimeBudget,
    startTime: isAd ? null : instant(raw.start_time),
    // Campanha chama de `stop_time` o que o conjunto chama de `end_time`.
    endTime: isCampaign
      ? instant(raw.stop_time)
      : isAdset
        ? instant(raw.end_time)
        : null,

    optimizationGoal: isAdset ? text(raw.optimization_goal) : null,
    billingEvent: isAdset ? text(raw.billing_event) : null,
    bidAmount: isAdset ? configuredMoney(raw.bid_amount) : null,
    destinationType: isAdset ? text(raw.destination_type) : null,
    isDynamicCreative: isAdset ? flag(raw.is_dynamic_creative) : null,
    targeting: isAdset ? jsonOrNull(raw.targeting) : null,
    promotedObject: isAdset ? jsonOrNull(raw.promoted_object) : null,
    attributionSpec: isAdset ? jsonOrNull(raw.attribution_spec) : null,
    frequencyControlSpecs: isAdset
      ? jsonOrNull(raw.frequency_control_specs)
      : null,
    pacingType: isAdset ? jsonOrNull(raw.pacing_type) : null,
    dsaBeneficiary: isAdset ? text(raw.dsa_beneficiary) : null,
    dsaPayor: isAdset ? text(raw.dsa_payor) : null,

    // O deep fetch pede `creative{id}`; contas antigas devolvem `creative_id`.
    creativeId: isAd
      ? (text(raw.creative_id) ??
        text((raw.creative as { id?: unknown } | undefined)?.id))
      : null,
    conversionDomain: isAd ? text(raw.conversion_domain) : null,
    trackingSpecs: isAd ? jsonOrNull(raw.tracking_specs) : null,
  };
}

/** A metade volátil da resposta — o que a confirmação atualiza sem abrir versão. */
export function projectVolatileColumns(
  raw: Record<string, unknown>,
): TrackedVolatileColumns {
  return {
    effectiveStatus: text(raw.effective_status),
    budgetRemaining: numeric(raw.budget_remaining),
    learningStageInfo: jsonOrNull(raw.learning_stage_info),
    issuesInfo: jsonOrNull(raw.issues_info),
    updatedTimeMeta: instant(raw.updated_time),
    lastBudgetTogglingTime: instant(raw.last_budget_toggling_time),
  };
}

/**
 * Campanha Gerenciada: o nome começa com o prefixo configurável das regras
 * operacionais do negócio (`business_operating_rules.managed_campaign_name_prefix`).
 * Avaliado POR VERSÃO — renomear muda a marca daqui para frente sem reescrever
 * a história.
 */
export function hasManagedPrefix(
  name: string | null | undefined,
  prefix: string,
): boolean {
  if (!name || !prefix) return false;
  return name.trim().startsWith(prefix);
}
