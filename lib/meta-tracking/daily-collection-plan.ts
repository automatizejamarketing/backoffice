/**
 * As decisões do coletor diário, todas puras (§5 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * O executor do coletor é fino de propósito: ele busca na Graph API, grava no
 * Postgres e não decide nada. TUDO que é decisão mora aqui ou na costura do
 * delta (`compute-tracking-delta.ts`) — quais entidades merecem fetch profundo,
 * qual era o estado anterior da conta, se o dia já está coberto, se ainda há
 * orçamento de invocação. É isso que permite testar o comportamento do coletor
 * sem banco e sem rede.
 *
 * ## As três decisões que este arquivo carrega
 *
 * 1. **Fetch profundo só para quem entrega.** Campanha que não gasta não é
 *    trackeada em profundidade; a listagem completa continua vendo todo mundo,
 *    porque é dela que saem criações e transições de ciclo de vida.
 * 2. **O pré-filtro de "atualizado desde" vale para conjunto e anúncio, nunca
 *    para campanha.** A Meta documenta que mudança de orçamento NÃO atualiza o
 *    `updated_time` da campanha — confiar nele perderia exatamente a mudança
 *    mais importante de todas. Campanhas passam por diff completo todo dia.
 * 3. **O estado anterior tem duas fontes.** Quem já teve fetch profundo tem
 *    versão vigente; quem nunca esteve ativo só existe no stream de eventos. As
 *    duas são conciliadas pela mais RECENTE — a versão congela o estado do
 *    último fetch profundo, e quem pausa some do fetch profundo no dia seguinte.
 */

import type {
  KnownConfigVersion,
  KnownEntityState,
  TrackingListingEntity,
} from "@/lib/meta-tracking/compute-tracking-delta";
import type {
  MetaTrackingCoverageStatus,
  MetaTrackingEntityLevel,
} from "@/lib/db/schema";

/**
 * A entidade como a listagem diária a devolve, com o carimbo de atualização que
 * o pré-filtro usa. O campo é opcional porque nem todo nível o entrega de forma
 * confiável — e quando falta, o pré-filtro simplesmente não se aplica.
 */
export type ListedEntity = TrackingListingEntity & {
  updatedTime?: Date | null;
};

/**
 * O estado anterior como o COLETOR o carrega: o que a costura do delta pede,
 * mais o instante da última confirmação — que é o "desde" do pré-filtro e o
 * critério para saber se a versão ou o stream de eventos está mais fresco.
 */
export type TrackedEntityState = KnownEntityState & {
  /** `last_confirmed_at` da versão vigente; `null` quando não há versão. */
  confirmedAt: Date | null;
};

/**
 * Estados efetivos pedidos na listagem, POR NÍVEL — a lista documentada de
 * `effective_status` de cada edge da Marketing API v25.
 *
 * Pedir explicitamente é obrigatório para o ARQUIVAMENTO: sem o filtro, o edge
 * omite arquivadas, e a costura do delta (que nunca infere remoção por
 * ausência, para não escrever mentira quando a listagem é truncada) jamais
 * registraria um arquivamento — que é fim de linha e precisa entrar no stream.
 * Valor fora da lista do nível é rejeitado como parâmetro inválido, daí a lista
 * ser por nível e não uma só.
 *
 * `DELETED` está FORA de propósito, e isso é imposição da Meta, não escolha: os
 * edges `/campaigns`, `/adsets` e `/ads` respondem 400 (código 100, subcódigo
 * 1815001, "A solicitação de objetos excluídos não é aceita neste ponto de
 * extremidade") quando `DELETED` aparece no filtro — inclusive sozinho, e a
 * rejeição derruba a requisição INTEIRA, levando junto todos os outros estados.
 * Medido contra a v25 em 2026-08-10 nos três níveis; `ARCHIVED` passa nos três.
 *
 * A consequência é conhecida e aceita: remoção de verdade não é observável por
 * esta listagem. Quem a reporta é o fetch profundo de uma entidade já conhecida
 * (buscar por id ainda devolve `effective_status` `DELETED`, e a costura do
 * delta traduz isso em `deleted_detected`) e o audit trail de `/activities`.
 */
export const LISTING_EFFECTIVE_STATUSES: Record<
  MetaTrackingEntityLevel,
  readonly string[]
> = {
  campaign: ["ACTIVE", "PAUSED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES"],
  adset: [
    "ACTIVE",
    "PAUSED",
    "ARCHIVED",
    "CAMPAIGN_PAUSED",
    "IN_PROCESS",
    "WITH_ISSUES",
  ],
  ad: [
    "ACTIVE",
    "PAUSED",
    "ARCHIVED",
    "CAMPAIGN_PAUSED",
    "ADSET_PAUSED",
    "IN_PROCESS",
    "WITH_ISSUES",
    "PENDING_REVIEW",
    "DISAPPROVED",
    "PREAPPROVED",
    "PENDING_BILLING_INFO",
  ],
};

/** O estado efetivo que faz uma entidade merecer fetch profundo. */
const DELIVERING_EFFECTIVE_STATUS = "ACTIVE";

/** Teto de ids por node batch da Graph API (`?ids=a,b,c`). */
export const DEEP_FETCH_CHUNK_SIZE = 50;

/** Ordem de coleta: o pai antes do filho, para o log ficar legível. */
const LEVEL_ORDER: readonly MetaTrackingEntityLevel[] = [
  "campaign",
  "adset",
  "ad",
];

/** Níveis cujo carimbo de atualização a Meta mantém confiável. */
const PREFILTERABLE_LEVELS: ReadonlySet<MetaTrackingEntityLevel> = new Set([
  "adset",
  "ad",
]);

export type DeepFetchChunk = {
  entityLevel: MetaTrackingEntityLevel;
  entityIds: string[];
};

export type DeepFetchPlan = {
  /** Lotes de ids para o node batch, na ordem campanha → conjunto → anúncio. */
  chunks: DeepFetchChunk[];
  /** Entidades com entrega ativa vistas na listagem. */
  activeSeen: number;
  /** Ativas poupadas pelo pré-filtro de "atualizado desde". */
  prefiltered: number;
};

/** Quebra ids em lotes do tamanho que o node batch suporta. */
export function chunkIds(ids: readonly string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push([...ids.slice(i, i + size)]);
  }
  return chunks;
}

function entityKey(
  level: MetaTrackingEntityLevel,
  entityId: string,
): string {
  return `${level}:${entityId}`;
}

export type PlanDeepFetchInput = {
  listing: readonly ListedEntity[];
  previous: readonly TrackedEntityState[];
  chunkSize?: number;
};

/**
 * Quem recebe fetch profundo hoje.
 *
 * Ativa sem versão vigente entra SEMPRE, mesmo com carimbo antigo: quando o pai
 * é despausado, o filho volta a entregar sem que o `updated_time` dele mude, e
 * confiar no carimbo deixaria a entidade reativada para sempre sem versão.
 */
export function planDeepFetch(input: PlanDeepFetchInput): DeepFetchPlan {
  const previousByKey = new Map<string, TrackedEntityState>();
  for (const state of input.previous) {
    previousByKey.set(entityKey(state.entityLevel, state.entityId), state);
  }

  const idsByLevel = new Map<MetaTrackingEntityLevel, string[]>();
  let activeSeen = 0;
  let prefiltered = 0;

  for (const entity of input.listing) {
    if (entity.effectiveStatus !== DELIVERING_EFFECTIVE_STATUS) continue;
    activeSeen += 1;

    const previous = previousByKey.get(
      entityKey(entity.entityLevel, entity.entityId),
    );
    const confirmedAt = previous?.currentVersion ? previous.confirmedAt : null;

    if (
      PREFILTERABLE_LEVELS.has(entity.entityLevel) &&
      confirmedAt !== null &&
      entity.updatedTime instanceof Date &&
      entity.updatedTime.getTime() <= confirmedAt.getTime()
    ) {
      prefiltered += 1;
      continue;
    }

    const ids = idsByLevel.get(entity.entityLevel) ?? [];
    ids.push(entity.entityId);
    idsByLevel.set(entity.entityLevel, ids);
  }

  const chunkSize = Math.max(1, input.chunkSize ?? DEEP_FETCH_CHUNK_SIZE);
  const chunks: DeepFetchChunk[] = [];
  for (const entityLevel of LEVEL_ORDER) {
    for (const entityIds of chunkIds(idsByLevel.get(entityLevel) ?? [], chunkSize)) {
      chunks.push({ entityLevel, entityIds });
    }
  }

  return { chunks, activeSeen, prefiltered };
}

/** Linha de `meta_tracking_config_versions` vigente, como o coletor a lê. */
export type CurrentVersionRow = {
  id: string;
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  versionNumber: number;
  configHash: string;
  isManaged: boolean;
  config: unknown;
  /** Coluna volátil: o estado efetivo do último fetch profundo. */
  effectiveStatus: string | null;
  lastConfirmedAt: Date;
};

/**
 * A última transição de estado efetivo registrada no stream de ações — a única
 * fonte de estado anterior para quem nunca esteve ativo e portanto nunca teve
 * versão nenhuma.
 */
export type LifecycleStatusRow = {
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  effectiveStatus: string | null;
  occurredAt: Date;
};

export type BuildTrackedEntityStatesInput = {
  versions: readonly CurrentVersionRow[];
  lifecycle: readonly LifecycleStatusRow[];
};

/**
 * Reconstrói o estado anterior da conta a partir do que está gravado.
 *
 * As duas fontes discordam por construção: a coluna volátil da versão congela
 * no dia do último fetch profundo (e quem pausa sai do fetch profundo), enquanto
 * o stream registra a transição no dia em que ela aconteceu. Vence a observação
 * mais RECENTE; empatou, vence o stream, que é a fonte de ciclo de vida.
 */
export function buildTrackedEntityStates(
  input: BuildTrackedEntityStatesInput,
): TrackedEntityState[] {
  const states = new Map<string, TrackedEntityState>();

  for (const row of input.versions) {
    const currentVersion: KnownConfigVersion = {
      id: row.id,
      versionNumber: row.versionNumber,
      configHash: row.configHash,
      isManaged: row.isManaged,
      config: (row.config ?? {}) as Record<string, unknown>,
    };
    states.set(entityKey(row.entityLevel, row.entityId), {
      entityLevel: row.entityLevel,
      entityId: row.entityId,
      lastEffectiveStatus: row.effectiveStatus ?? null,
      confirmedAt: row.lastConfirmedAt,
      currentVersion,
    });
  }

  for (const row of input.lifecycle) {
    const key = entityKey(row.entityLevel, row.entityId);
    const existing = states.get(key);

    if (!existing) {
      states.set(key, {
        entityLevel: row.entityLevel,
        entityId: row.entityId,
        lastEffectiveStatus: row.effectiveStatus ?? null,
        confirmedAt: null,
        currentVersion: null,
      });
      continue;
    }

    const confirmedAt = existing.confirmedAt?.getTime() ?? -Infinity;
    if (row.occurredAt.getTime() >= confirmedAt) {
      existing.lastEffectiveStatus = row.effectiveStatus ?? null;
    }
  }

  return [...states.values()];
}

/**
 * Status de cobertura que encerram a conta NO DIA.
 *
 * Só `partial` fica pendente, e por um motivo exato: parcial não é erro, é a
 * parada preventiva por cota — o disparo seguinte do cron existe para terminar
 * o que ela interrompeu.
 *
 * `failed` é terminal por duas razões que puxam para o mesmo lado. A licença
 * Meta do app é throttled por TAXA DE ERRO: reinsistir em cada disparo da
 * madrugada multiplicaria por nove os erros de uma conta que está falhando
 * sistematicamente. E o lote de cada invocação é finito — conta que falha
 * sempre roubaria a vaga de conta que ainda não foi tentada nenhuma vez. Falha
 * transitória volta amanhã; quem quiser hoje roda o script com `--all`.
 *
 * `skipped_*` é terminal pelo motivo mais simples: sem token não há o que
 * tentar de novo no mesmo dia.
 */
const TERMINAL_COVERAGE_STATUSES: ReadonlySet<MetaTrackingCoverageStatus> =
  new Set(["complete", "failed", "skipped_reconnect", "skipped_no_token"]);

/** O dia desta conta já está resolvido? É o claim `onlyStale` do cron. */
export function isDayCoveredBy(
  status: MetaTrackingCoverageStatus | null | undefined,
): boolean {
  return status != null && TERMINAL_COVERAGE_STATUSES.has(status);
}

/**
 * Conta que não pôde ser coletada por falta de token: reconexão pendente tem
 * status próprio porque é o buraco que a tela de operação precisa destacar — o
 * cliente tem de ser acionado antes que a série cresça com dias vazios.
 */
export function coverageStatusForTokenFailure(failure: {
  needsReconnect?: boolean;
}): MetaTrackingCoverageStatus {
  return failure.needsReconnect ? "skipped_reconnect" : "skipped_no_token";
}

export type CollectionBudget = {
  startedAt: Date;
  now: Date;
  accountsProcessed: number;
  maxAccounts: number;
  softDeadlineMs: number;
};

/**
 * Ainda cabe mais uma conta nesta invocação?
 *
 * O limite de duração da plataforma é o motivo do desenho inteiro: cada disparo
 * drena um lote e para com folga, e a cobertura conta×dia garante que o próximo
 * disparo continue de onde este parou em vez de recomeçar.
 */
export function hasCollectionBudgetLeft(budget: CollectionBudget): boolean {
  if (budget.accountsProcessed >= budget.maxAccounts) return false;
  return (
    budget.now.getTime() - budget.startedAt.getTime() < budget.softDeadlineMs
  );
}
