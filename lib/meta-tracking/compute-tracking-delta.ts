/**
 * Costura 1 — cálculo do delta de tracking (§5.1–5.3 do plano
 * `docs/plans/campaign-tracking-foundation.md`, "Costura 1" da spec).
 *
 * Recebe o estado anterior conhecido de uma conta e as respostas da Graph API
 * de hoje; devolve o delta como DADOS: versões novas, eventos com o diff campo
 * a campo já computado e confirmações do que continua igual. Sem I/O — nada
 * aqui importa banco nem faz fetch, e é por isso que é aqui que os casos
 * difíceis são testados. O coletor diário, o backfill e a deduplicação de
 * escritas internas reusam esta mesma função.
 *
 * ## As três regras que este módulo carrega
 *
 * 1. **Idempotência é regra de CÓDIGO, não do banco.** O unique
 *    `(entity_level, entity_id, config_hash, valid_from)` só colide quando o
 *    `valid_from` é idêntico — com `valid_from = agora`, reexecutar a coleta no
 *    mesmo dia criaria uma segunda versão. Por isso a comparação é sempre com a
 *    versão VIGENTE: hash igual ⇒ nenhuma versão, nenhum evento, só
 *    `last_confirmed_at`.
 * 2. **Fechar a antiga e abrir a nova é uma coisa só.** O banco não impede duas
 *    versões abertas para a mesma entidade (o índice da versão vigente é comum,
 *    não único). O invariante é do executor: `supersedesVersionId` marca a linha
 *    a fechar com `valid_to = validFrom`, na MESMA transação do insert da nova.
 * 3. **Estado efetivo é ciclo de vida, não configuração.** Ele cai por cascata
 *    quando o pai pausa e voltaria a subir sozinho — vira evento de transição,
 *    nunca versão nova. Quem decide isso é `VOLATILE_CONFIG_FIELDS`, no módulo
 *    de configuração.
 *
 * ## O que esta costura deliberadamente NÃO faz
 *
 * - **Não infere remoção por ausência.** Entidade que sumiu da listagem é
 *   ignorada, porque a listagem pode ter sido interrompida no meio (a coleta
 *   aborta a conta preventivamente quando a cota aperta, gravando cobertura
 *   `partial`). Inventar `deleted_detected` a partir de uma listagem truncada
 *   escreveria mentira permanente no stream. Remoção é reconhecida quando a
 *   Meta a REPORTA (`effective_status` `DELETED`/`ARCHIVED`).
 * - **Não infere autoria.** O que ela detecta nasce com origem
 *   `external_detected`. Uma mudança que a plataforma mesma fez já entrou no
 *   stream pela camada de wrapper das rotas, com autor e motivo — e é por isso
 *   que `internalChanges` existe: alimentada com essas ações, a costura
 *   reconhece o que já foi registrado, não duplica o evento e apenas liga a
 *   versão nova ao evento que já está lá (`versionLinks`).
 *
 * ## Duas entradas, dois papéis
 *
 * `listing` é o que a conta INTEIRA mostra (ids e estados, barato) e é a única
 * fonte de ciclo de vida: criação e transição saem de lá. `configs` é o fetch
 * profundo, feito só para quem tem entrega ativa, e é a única fonte de versão.
 *
 * A consequência é aproveitada de propósito pelo backfill (§6 do plano):
 * alimentar a costura com `configs` e SEM `listing` produz as versões iniciais
 * de todas as entidades — inclusive pausadas e arquivadas — sem gerar um
 * `created` retroativo para quem já existia antes do tracking começar.
 */

import type {
  MetaTrackingChangedFields,
  MetaTrackingChangeKind,
  MetaTrackingChangeSource,
  MetaTrackingEntityLevel,
} from "@/lib/db/schema";

import {
  hasManagedPrefix,
  hashTrackedConfig,
  normalizeTrackedConfig,
  projectVersionColumns,
  projectVolatileColumns,
  type NormalizedConfig,
  type TrackedVersionColumns,
  type TrackedVolatileColumns,
} from "@/lib/meta-tracking/config-version";
import {
  isAppliedToMeta,
  sameMetaFieldValue,
} from "@/lib/meta-tracking/internal-change-event";

// ================================
// Entrada
// ================================

/**
 * Uma entidade como a listagem diária a vê: id, hierarquia e estado. É barata
 * (1–2 chamadas paginadas por conta) e cobre TODAS as entidades, inclusive as
 * que não recebem tracking profundo — é dela que saem criações e transições.
 */
export type TrackingListingEntity = {
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  name?: string | null;
  campaignId?: string | null;
  adsetId?: string | null;
  /** Status configurado (o interruptor que a pessoa mexeu). */
  status?: string | null;
  /** Estado efetivo — a entrega real, que cai por cascata quando o pai pausa. */
  effectiveStatus?: string | null;
};

/** A resposta crua do fetch profundo, só para entidades com entrega ativa. */
export type TrackingConfigObservation = {
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  config: Record<string, unknown>;
};

/**
 * A versão vigente (`valid_to IS NULL`) como o banco a guarda. `config` é a
 * resposta integral gravada na coleta anterior — a normalização para o diff
 * acontece aqui, para que exista um normalizador só.
 */
export type KnownConfigVersion = {
  id: string;
  versionNumber: number;
  configHash: string;
  isManaged: boolean;
  config: Record<string, unknown>;
};

/**
 * O que se sabe de uma entidade antes desta observação.
 *
 * `lastEffectiveStatus` de uma entidade sem versão (nunca esteve ativa, logo
 * nunca teve tracking profundo) vem do stream de eventos — o último
 * `changed_fields.effective_status.new` dela. Ausente = entidade nunca vista.
 */
export type KnownEntityState = {
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  lastEffectiveStatus?: string | null;
  currentVersion?: KnownConfigVersion | null;
};

/**
 * Uma ação que a PLATAFORMA já registrou no stream — pelo backoffice (com
 * motivo) ou pelo painel do cliente —, lida do banco antes da coleta.
 *
 * O coletor enxerga a mesma mudança um dia depois e, sem isto, escreveria um
 * segundo evento dizendo "alguém mexeu, não sei quem": o stream passaria a ter
 * duas ações para um fato só, e a de baixo qualidade apagaria a de cima na
 * leitura. `changedFields` chega no MESMO vocabulário do diff do coletor
 * (chaves de primeiro nível da Graph API) — é o que torna a comparação possível.
 */
export type RecentInternalChange = {
  changeEventId: string;
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  changeKind: MetaTrackingChangeKind;
  changedFields: MetaTrackingChangedFields;
  occurredAt: Date;
};

export type TrackingDeltaInput = {
  userId: string;
  accountId: string;
  /** Instante da observação: vira `valid_from`, `detected_at` e `occurred_at`. */
  observedAt: Date;
  /** Prefixo de Campanha Gerenciada das regras operacionais do negócio. */
  managedCampaignNamePrefix: string;
  listing: readonly TrackingListingEntity[];
  configs: readonly TrackingConfigObservation[];
  previous: readonly KnownEntityState[];
  /**
   * Ações internas recentes da conta. Ausente = coleta sem deduplicação (o
   * backfill, por exemplo, que roda sobre um passado que ninguém editou por
   * aqui).
   */
  internalChanges?: readonly RecentInternalChange[];
};

// ================================
// Saída
// ================================

/**
 * Uma linha a inserir em `meta_tracking_config_versions`.
 *
 * `ref` é a chave local que os eventos deste mesmo delta usam para apontar para
 * a versão nova: o uuid só existe depois do insert.
 */
export type TrackingVersionDraft = {
  ref: string;
  userId: string;
  accountId: string;
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  entityName: string | null;
  campaignId: string | null;
  adsetId: string | null;
  versionNumber: number;
  validFrom: Date;
  lastConfirmedAt: Date;
  configHash: string;
  /** Resposta integral da Graph API, como veio. */
  config: Record<string, unknown>;
  isManaged: boolean;
  columns: TrackedVersionColumns;
  volatile: TrackedVolatileColumns;
  /** Versão a fechar com `valid_to = validFrom`, na MESMA transação. */
  supersedesVersionId: string | null;
};

/** Uma linha a inserir em `meta_tracking_change_events`. */
export type TrackingChangeEventDraft = {
  userId: string;
  accountId: string;
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  entityName: string | null;
  campaignId: string | null;
  adsetId: string | null;
  changeKind: MetaTrackingChangeKind;
  changedFields: MetaTrackingChangedFields;
  source: MetaTrackingChangeSource;
  fromConfigVersionId: string | null;
  /** `ref` da versão nova deste delta; o executor troca pelo uuid inserido. */
  toVersionRef: string | null;
  occurredAt: Date;
  detectedAt: Date;
};

/**
 * "Continua igual": só mexe em `last_confirmed_at` e nos campos voláteis da
 * versão vigente. É o caminho da reexecução no mesmo dia.
 */
export type TrackingVersionConfirmation = {
  versionId: string;
  lastConfirmedAt: Date;
  volatile: TrackedVolatileColumns;
};

/**
 * "Este evento que já está no stream é o que produziu esta versão nova": o
 * executor faz `UPDATE meta_tracking_change_events SET to_config_version_id`.
 * É o que fecha o ciclo de uma ação interna — ela nasce sem versão (a versão só
 * existe depois que a coleta confirma a configuração nova) e ganha o destino
 * aqui.
 */
export type TrackingVersionLink = {
  changeEventId: string;
  /** `ref` da versão nova deste delta; o executor troca pelo uuid inserido. */
  toVersionRef: string;
};

export type TrackingDelta = {
  versions: TrackingVersionDraft[];
  events: TrackingChangeEventDraft[];
  confirmations: TrackingVersionConfirmation[];
  versionLinks: TrackingVersionLink[];
};

/**
 * Janela de tolerância entre a ação registrada e a coleta que a enxerga. Vinte
 * e quatro horas cobrem o caso real — a coleta roda de madrugada e a ação
 * aconteceu em algum momento do dia anterior — sem esticar a ponto de casar
 * duas edições distintas do mesmo campo em dias seguidos.
 */
export const INTERNAL_CHANGE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

// ================================
// Cálculo
// ================================

function entityKey(
  level: MetaTrackingEntityLevel,
  entityId: string,
): string {
  return `${level}:${entityId}`;
}

/**
 * Diff campo a campo entre duas configurações normalizadas — o
 * `changed_fields` que a busca por campo alterado (`changed_fields ?
 * 'daily_budget'`) interroga, e a razão de nunca ser preciso comparar
 * configurações em tempo de consulta.
 *
 * As chaves são as de PRIMEIRO nível da resposta da Meta (`daily_budget`,
 * `targeting`, `name`…): um campo aninhado que muda aparece como o objeto
 * inteiro velho→novo. Campo ausente de um dos lados vira `null` — jsonb não
 * guarda `undefined`, e "ausente" e "nulo" significam a mesma coisa aqui.
 *
 * Comparação por JSON canônico: as duas configurações vieram de
 * `normalizeTrackedConfig`, que já ordenou as chaves de todo objeto aninhado.
 */
function diffNormalizedConfigs(
  before: NormalizedConfig,
  after: NormalizedConfig,
): MetaTrackingChangedFields {
  const changed: MetaTrackingChangedFields = {};
  for (const key of new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ])) {
    const old = before[key] ?? null;
    const next = after[key] ?? null;
    if (JSON.stringify(old) === JSON.stringify(next)) continue;
    changed[key] = { old, new: next };
  }
  return changed;
}

/**
 * Como a Meta REPORTA que a entidade saiu de cena. Arquivamento e remoção têm
 * tipo próprio no stream porque são fim de linha — pausar é reversível, esses
 * dois praticamente não são.
 */
function lifecycleKindFor(effectiveStatus: string): MetaTrackingChangeKind {
  if (effectiveStatus === "ARCHIVED") return "archived";
  if (effectiveStatus === "DELETED") return "deleted_detected";
  return "status_transition";
}

/**
 * O estado para onde uma ação interna disse que a entidade foi. As rotas
 * registram o status CONFIGURADO (`status` — o interruptor que a pessoa mexeu)
 * e o coletor observa o EFETIVO (`effective_status` — a entrega). Quando quem
 * pausou foi a pessoa, os dois contam o mesmo fato com nomes diferentes.
 */
function internalStatusTarget(change: RecentInternalChange): unknown {
  const status = change.changedFields.status ?? change.changedFields.effective_status;
  return status?.new;
}

/**
 * Casa a transição observada com uma ação interna ainda não usada. Consome a
 * ação: um evento interno explica UMA mudança, não todas as que se parecerem
 * com ela.
 */
function takeLifecycleExplanation(args: {
  candidates: readonly RecentInternalChange[];
  consumed: Set<string>;
  isCreation: boolean;
  observedStatus: string;
}): RecentInternalChange | null {
  for (const candidate of args.candidates) {
    if (args.consumed.has(candidate.changeEventId)) continue;

    const explains = args.isCreation
      ? candidate.changeKind === "created"
      : sameMetaFieldValue(internalStatusTarget(candidate), args.observedStatus);

    if (!explains) continue;
    args.consumed.add(candidate.changeEventId);
    return candidate;
  }
  return null;
}

export function computeTrackingDelta(input: TrackingDeltaInput): TrackingDelta {
  const delta: TrackingDelta = {
    versions: [],
    events: [],
    confirmations: [],
    versionLinks: [],
  };

  const previousByKey = new Map<string, KnownEntityState>();
  for (const state of input.previous) {
    previousByKey.set(entityKey(state.entityLevel, state.entityId), state);
  }

  // Ações internas que podem explicar o que a coleta vai encontrar. Fora da
  // janela de tolerância não explicam nada, e uma que a Meta RECUSOU explica
  // menos ainda: se a alteração não foi aplicada, o que o coletor está vendo é
  // outra pessoa mexendo — e o stream tem de dizer isso.
  const internalByKey = new Map<string, RecentInternalChange[]>();
  for (const change of input.internalChanges ?? []) {
    const distance = Math.abs(
      input.observedAt.getTime() - change.occurredAt.getTime(),
    );
    if (distance > INTERNAL_CHANGE_TOLERANCE_MS) continue;
    if (!isAppliedToMeta(change.changedFields)) continue;

    const key = entityKey(change.entityLevel, change.entityId);
    const bucket = internalByKey.get(key);
    if (bucket) bucket.push(change);
    else internalByKey.set(key, [change]);
  }
  const consumedInternalChanges = new Set<string>();

  const listingByKey = new Map<string, TrackingListingEntity>();
  for (const entity of input.listing) {
    listingByKey.set(entityKey(entity.entityLevel, entity.entityId), entity);
  }

  const configByKey = new Map<string, TrackingConfigObservation>();
  for (const observation of input.configs) {
    configByKey.set(
      entityKey(observation.entityLevel, observation.entityId),
      observation,
    );
  }

  // A listagem dita a ordem (é ela que enxerga a conta inteira); uma
  // configuração de entidade fora da listagem entra depois, sem se perder.
  const keysInOrder = [...listingByKey.keys()];
  for (const key of configByKey.keys()) {
    if (!listingByKey.has(key)) keysInOrder.push(key);
  }

  // Quais campanhas desta observação são Gerenciadas. O prefixo vive no nome da
  // CAMPANHA — conjuntos e anúncios da plataforma têm nome livre —, então a
  // marca do filho é herdada do pai, avaliada com o nome que o pai tinha AGORA.
  const managedByCampaignId = new Map<string, boolean>();
  for (const entity of input.listing) {
    if (entity.entityLevel !== "campaign") continue;
    managedByCampaignId.set(
      entity.entityId,
      hasManagedPrefix(entity.name, input.managedCampaignNamePrefix),
    );
  }
  for (const observation of input.configs) {
    if (observation.entityLevel !== "campaign") continue;
    const name = observation.config.name;
    managedByCampaignId.set(
      observation.entityId,
      hasManagedPrefix(
        typeof name === "string" ? name : null,
        input.managedCampaignNamePrefix,
      ),
    );
  }

  const isManagedVersion = (
    level: MetaTrackingEntityLevel,
    entityName: string | null,
    campaignId: string | null,
  ): boolean => {
    if (hasManagedPrefix(entityName, input.managedCampaignNamePrefix)) {
      return true;
    }
    if (level === "campaign" || campaignId === null) return false;
    return managedByCampaignId.get(campaignId) ?? false;
  };

  for (const key of keysInOrder) {
    const listed = listingByKey.get(key);
    const observation = configByKey.get(key);
    const previous = previousByKey.get(key);
    const current = previous?.currentVersion ?? null;

    const internalCandidates = internalByKey.get(key) ?? [];
    /** Ação interna que já registrou a criação desta entidade, se houver. */
    let internalCreation: RecentInternalChange | null = null;

    // ---- Ciclo de vida: só a listagem vê todas as entidades da conta.
    if (listed) {
      const observedStatus = listed.effectiveStatus ?? null;
      const knownStatus = previous?.lastEffectiveStatus ?? null;
      const isNewToTracking = previous === undefined;
      const statusMoved =
        observedStatus !== null && observedStatus !== knownStatus;

      // Pausar, retomar ou criar pela plataforma já virou ação no stream, com
      // autor e motivo. Reescrever isso como "detectado externamente" seria
      // trocar uma ação assinada por uma anônima.
      const explainedInternally =
        (isNewToTracking || statusMoved) && observedStatus !== null
          ? takeLifecycleExplanation({
              candidates: internalCandidates,
              consumed: consumedInternalChanges,
              isCreation: isNewToTracking,
              observedStatus,
            })
          : null;
      if (explainedInternally && isNewToTracking) {
        internalCreation = explainedInternally;
      }

      if ((isNewToTracking || statusMoved) && !explainedInternally) {
        delta.events.push({
          userId: input.userId,
          accountId: input.accountId,
          entityLevel: listed.entityLevel,
          entityId: listed.entityId,
          entityName: listed.name ?? null,
          campaignId: listed.campaignId ?? null,
          adsetId: listed.adsetId ?? null,
          changeKind:
            isNewToTracking || observedStatus === null
              ? "created"
              : lifecycleKindFor(observedStatus),
          // O estado com que a entidade foi vista fica registrado no stream: é
          // daqui que a próxima execução reconstrói o último status conhecido
          // de quem nunca esteve ativo e portanto não tem versão nenhuma.
          changedFields:
            observedStatus === null
              ? {}
              : {
                  effective_status: { old: knownStatus, new: observedStatus },
                },
          source: "external_detected",
          fromConfigVersionId: null,
          // Criação com configuração aponta para a primeira versão; transição
          // não abre versão nenhuma — estado efetivo é volátil por decisão.
          toVersionRef: isNewToTracking && observation ? key : null,
          occurredAt: input.observedAt,
          detectedAt: input.observedAt,
        });
      }
    }

    // ---- Configuração: só quem tem entrega ativa recebe fetch profundo.
    if (!observation) continue;

    const normalized = normalizeTrackedConfig(observation.config);
    const configHash = hashTrackedConfig(normalized);

    if (current && configHash === current.configHash) {
      delta.confirmations.push({
        versionId: current.id,
        lastConfirmedAt: input.observedAt,
        volatile: projectVolatileColumns(observation.config),
      });
      continue;
    }

    const columns = projectVersionColumns(
      observation.entityLevel,
      observation.config,
    );
    const entityName = columns.entityName ?? listed?.name ?? null;
    const campaignId = columns.campaignId ?? listed?.campaignId ?? null;

    const version: TrackingVersionDraft = {
      ref: key,
      userId: input.userId,
      accountId: input.accountId,
      entityLevel: observation.entityLevel,
      entityId: observation.entityId,
      entityName,
      campaignId,
      adsetId: columns.adsetId ?? listed?.adsetId ?? null,
      versionNumber: current ? current.versionNumber + 1 : 1,
      validFrom: input.observedAt,
      lastConfirmedAt: input.observedAt,
      configHash,
      config: observation.config,
      isManaged: isManagedVersion(
        observation.entityLevel,
        entityName,
        campaignId,
      ),
      columns,
      volatile: projectVolatileColumns(observation.config),
      supersedesVersionId: current?.id ?? null,
    };
    delta.versions.push(version);

    // A criação já registrada internamente ganha aqui o destino que ela não
    // podia ter no momento da escrita: a versão só existe depois que a coleta
    // confirma a configuração.
    if (internalCreation) {
      delta.versionLinks.push({
        changeEventId: internalCreation.changeEventId,
        toVersionRef: version.ref,
      });
    }

    if (current) {
      let changedFields = diffNormalizedConfigs(
        normalizeTrackedConfig(current.config),
        normalized,
      );

      // Cada ação interna abate do diff os campos que ela já registrou. O que
      // sobrar é o que mais alguém mexeu por fora — e só isso vira evento novo.
      for (const candidate of internalCandidates) {
        if (consumedInternalChanges.has(candidate.changeEventId)) continue;

        const explained = Object.keys(candidate.changedFields).filter(
          (field) =>
            field in changedFields &&
            sameMetaFieldValue(
              candidate.changedFields[field].new,
              changedFields[field].new,
            ),
        );
        if (explained.length === 0) continue;

        consumedInternalChanges.add(candidate.changeEventId);
        delta.versionLinks.push({
          changeEventId: candidate.changeEventId,
          toVersionRef: version.ref,
        });
        changedFields = Object.fromEntries(
          Object.entries(changedFields).filter(
            ([field]) => !explained.includes(field),
          ),
        );
      }

      if (Object.keys(changedFields).length > 0) {
        delta.events.push({
          userId: input.userId,
          accountId: input.accountId,
          entityLevel: observation.entityLevel,
          entityId: observation.entityId,
          entityName,
          campaignId: version.campaignId,
          adsetId: version.adsetId,
          changeKind: "config_change",
          changedFields,
          source: "external_detected",
          fromConfigVersionId: current.id,
          toVersionRef: version.ref,
          occurredAt: input.observedAt,
          detectedAt: input.observedAt,
        });
      }
    }
  }

  return delta;
}
