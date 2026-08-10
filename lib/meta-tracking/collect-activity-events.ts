/**
 * O passo de audit trail do coletor diário (§5.5 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Etapa separada e injetável, como a de métricas: recebe quatro portas — buscar
 * as atividades da conta, gravar os eventos crus, ler as ações que ainda não têm
 * autor e ligar as duas coisas — e coordena a ordem. Nada aqui fala HTTP ou SQL,
 * e é isso que permite exercitar a sobreposição de 48 h e a deduplicação sem
 * banco e sem rede.
 *
 * ## Por que este passo pode falhar sem consequência
 *
 * O `/activities` é a única fonte oficial de "quem mexeu", mas a Meta não
 * documenta a retenção dele nem o formato de `extra_data`. A fundação foi
 * desenhada para que isso não importe: o diff do coletor já registrou a ação
 * antes de este passo rodar. Quando o endpoint falha, a ação continua no stream
 * — anônima, com o horário da detecção — e a sobreposição do poll dá à execução
 * seguinte uma segunda chance de enriquecê-la. Por isso o orquestrador chama
 * este passo por fora do que decide a cobertura da conta.
 *
 * ## A ordem, e por que ela é essa
 *
 * 1. **Gravar tudo primeiro.** Todo evento cru é persistido, inclusive os que
 *    não têm relação com ação nenhuma (cobrança, públicos, papéis da conta) — o
 *    §4.4 os quer como matéria-prima de propósitos futuros, e eles não teriam
 *    como ser buscados depois.
 * 2. **Só então procurar o que eles explicam.** O match precisa do uuid da linha
 *    gravada para escrever os dois lados da ponte; e sem eventos crus não há o
 *    que perguntar ao banco.
 */

import {
  ACTIVITY_POLL_OVERLAP_MS,
  matchActivitiesToChanges,
  toActivityEventRows,
  type ActivityEventRow,
  type EnrichableChange,
  type RawActivity,
} from "@/lib/meta-tracking/activity-enrichment";
import type { QuotaUsage } from "@/lib/meta-tracking/quota-usage";
import type { TrackingCredentials } from "@/lib/meta-tracking/run-daily-collection";

/** Um evento cru já gravado: a chave de dedup e o uuid que ela ganhou. */
export type StoredActivityEvent = {
  id: string;
  dedupHash: string;
  /**
   * A ação que este evento já explicou, em qualquer execução anterior. Não é
   * curiosidade: a sobreposição de 48 h devolve o mesmo evento por dois dias, e
   * sem isto ele poderia explicar uma ação hoje e outra amanhã — dois fatos
   * distintos com a mesma causa declarada, e nenhum jeito de saber qual mente.
   */
  matchedChangeEventId: string | null;
};

/**
 * A ponte entre uma ação e o evento cru que a explica, com os dois lados
 * resolvidos. O executor escreve os DOIS: `activity_event_id` no evento de
 * mudança (a ponte canônica, com FK) e `matched_change_event_id` no evento cru
 * (sem FK, de propósito — ver o schema).
 */
export type ActivityLink = {
  changeEventId: string;
  activityEventId: string;
  actorName: string | null;
  /** O horário exato da ação; substitui o horário da detecção. */
  occurredAt: Date;
};

export type ActivityCollectionPorts = {
  /** As atividades da conta no período, já paginadas. */
  fetchActivities: (args: {
    accountId: string;
    credentials: TrackingCredentials;
    since: Date;
    until: Date;
  }) => Promise<{ rows: RawActivity[]; usage: QuotaUsage; apiCalls: number }>;
  /** Upsert por `dedup_hash`; devolve o uuid de cada linha, nova ou já existente. */
  upsertActivityEvents: (
    rows: readonly ActivityEventRow[],
  ) => Promise<StoredActivityEvent[]>;
  /** Ações detectadas pelo diff que ainda não têm autor, da mais recente para a mais antiga. */
  loadEnrichableChanges: (args: {
    accountId: string;
    since: Date;
  }) => Promise<EnrichableChange[]>;
  /** Escreve os dois lados da ponte; devolve quantas ações foram enriquecidas. */
  linkActivityMatches: (links: readonly ActivityLink[]) => Promise<number>;
};

export type CollectActivityEventsArgs = {
  userId: string;
  accountId: string;
  credentials: TrackingCredentials;
  /** O instante da coleta — define a janela de sobreposição do poll. */
  now: Date;
};

export type ActivityCollectionResult = {
  /** Eventos crus gravados (novos e reconfirmados pela sobreposição). */
  eventsUpserted: number;
  /** Ações que ganharam autor e horário exato. */
  eventsMatched: number;
  usage: QuotaUsage;
  apiCalls: number;
};

export async function collectActivityEvents(
  ports: ActivityCollectionPorts,
  args: CollectActivityEventsArgs,
): Promise<ActivityCollectionResult> {
  const since = new Date(args.now.getTime() - ACTIVITY_POLL_OVERLAP_MS);

  const fetched = await ports.fetchActivities({
    accountId: args.accountId,
    credentials: args.credentials,
    since,
    until: args.now,
  });

  const result: ActivityCollectionResult = {
    eventsUpserted: 0,
    eventsMatched: 0,
    usage: fetched.usage,
    apiCalls: fetched.apiCalls,
  };

  const rows = toActivityEventRows({
    userId: args.userId,
    accountId: args.accountId,
    rows: fetched.rows,
  });
  if (rows.length === 0) return result;

  const stored = await ports.upsertActivityEvents(rows);
  result.eventsUpserted = stored.length;

  // Quem já explicou uma ação está fora: um evento cru é a causa de um fato só,
  // e a sobreposição do poll o traz de volta todo dia.
  const idByDedupHash = new Map(
    stored
      .filter((event) => event.matchedChangeEventId === null)
      .map((event) => [event.dedupHash, event.id]),
  );
  if (idByDedupHash.size === 0) return result;

  const changes = await ports.loadEnrichableChanges({
    accountId: args.accountId,
    since,
  });
  if (changes.length === 0) return result;

  const available = rows.filter((row) => idByDedupHash.has(row.dedupHash));
  const links: ActivityLink[] = matchActivitiesToChanges({
    activities: available,
    changes,
  }).map((match) => ({
    changeEventId: match.changeEventId,
    // O match só pode ter saído de `available`, e `available` é exatamente o
    // que está no mapa.
    activityEventId: idByDedupHash.get(match.dedupHash)!,
    actorName: match.actorName,
    occurredAt: match.occurredAt,
  }));

  if (links.length > 0) {
    result.eventsMatched = await ports.linkActivityMatches(links);
  }

  return result;
}
