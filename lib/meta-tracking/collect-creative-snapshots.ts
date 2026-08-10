/**
 * O passo de snapshot de criativos do coletor (§4.6 e §5/4 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Etapa separada e injetável, como a de métricas e a de activities: recebe três
 * portas — descobrir quem ainda não tem snapshot, buscar o conteúdo na Meta e
 * gravar — e coordena a ordem. Nada aqui fala HTTP ou SQL, e é isso que permite
 * exercitar a tolerância a falha e o teto por execução sem banco e sem rede.
 *
 * ## Por que uma VARREDURA, e não o delta do dia
 *
 * Havia duas formas de descobrir "criativo desconhecido": olhar as versões de
 * anúncio que o delta acabou de criar, ou perguntar ao banco quais
 * `creative_id` das versões da conta ainda não têm linha em
 * `meta_tracking_creatives`. A segunda venceu porque é **auto-corretiva**:
 *
 * - pega de graça o passivo do baseline e do backfill, que criam versões de
 *   TODAS as entidades (inclusive pausadas e arquivadas) sem passar por delta
 *   diário nenhum;
 * - pega de graça o que falhou ontem — e criativo é imutável, então "tentar de
 *   novo amanhã" tem exatamente o mesmo resultado que teria hoje;
 * - não precisa de estado de pendência em lugar nenhum: a ausência da linha É
 *   a pendência.
 *
 * Pelo caminho do delta, um criativo que falhasse hoje só voltaria a ser
 * tentado quando o anúncio mudasse de configuração — isto é, possivelmente
 * nunca.
 *
 * ## Por que a falha aqui não custa a cobertura da conta
 *
 * Criativo é a única coisa que esta fundação coleta que NÃO perece: a Meta os
 * trata como imutáveis e eles continuam lá amanhã. A configuração do dia não
 * existe em lugar nenhum para ser buscada depois, e a série de resultados tem
 * janela; o criativo, não. Por isso este passo é o último do pipeline por
 * conta, roda por fora do que decide a cobertura, e é o primeiro a ceder a vez
 * quando a cota aperta.
 */

import {
  planCreativeFetch,
  toCreativeSnapshotRow,
  type CreativeSnapshotRow,
  type RawCreative,
} from "@/lib/meta-tracking/creative-snapshot";
import {
  mergeQuotaUsage,
  shouldStopForQuota,
  UNKNOWN_QUOTA_USAGE,
  type QuotaUsage,
} from "@/lib/meta-tracking/quota-usage";
import type { TrackingCredentials } from "@/lib/meta-tracking/run-daily-collection";

/**
 * Lotes recusados que encerram a conta no dia.
 *
 * Mesmo raciocínio do backfill (`MAX_SLICE_FAILURES_PER_ACCOUNT`): a licença
 * Meta do app é throttled por TAXA DE ERRO, e uma conta com problema sistemático
 * geraria um erro por lote. Duas recusas já dizem que a conta não vai render
 * hoje; o que ficou pendente continua pendente e volta amanhã.
 */
export const MAX_CREATIVE_FETCH_FAILURES = 2;

export type CreativeSnapshotPorts = {
  /**
   * Os `creative_id` referenciados por versões de anúncio desta conta que ainda
   * não têm snapshot. É a varredura: ausência de linha é a pendência.
   */
  listUnknownCreativeIds: (args: { accountId: string }) => Promise<string[]>;
  /** Um node batch de criativos, já com o field set e o recuo de campo. */
  fetchCreatives: (args: {
    accountId: string;
    credentials: TrackingCredentials;
    creativeIds: readonly string[];
  }) => Promise<{
    creatives: RawCreative[];
    usage: QuotaUsage;
    apiCalls: number;
  }>;
  /** Insert idempotente por id; devolve quantos snapshots nasceram. */
  insertCreatives: (rows: readonly CreativeSnapshotRow[]) => Promise<number>;
};

export type CollectCreativeSnapshotsArgs = {
  userId: string;
  accountId: string;
  credentials: TrackingCredentials;
  /** Cota já gasta pelas etapas anteriores desta conta. */
  usage?: QuotaUsage;
};

export type CreativeSnapshotResult = {
  /** Snapshots gravados nesta execução. */
  creativesFetched: number;
  /**
   * Criativos que continuam sem snapshot depois desta execução — o teto por
   * conta, o que a cota interrompeu, o que a Meta recusou e o que ela não
   * devolveu. A próxima varredura os encontra de novo.
   */
  creativesPending: number;
  usage: QuotaUsage;
  apiCalls: number;
  /** A busca parou no meio para não estourar a cota da conta. */
  stoppedForQuota: boolean;
  /** A Meta recusou algum lote; os ids dele continuam pendentes. */
  failureMessage: string | null;
};

export async function collectCreativeSnapshots(
  ports: CreativeSnapshotPorts,
  args: CollectCreativeSnapshotsArgs,
): Promise<CreativeSnapshotResult> {
  const result: CreativeSnapshotResult = {
    creativesFetched: 0,
    creativesPending: 0,
    usage: args.usage ?? UNKNOWN_QUOTA_USAGE,
    apiCalls: 0,
    stoppedForQuota: false,
    failureMessage: null,
  };

  const unknownIds = await ports.listUnknownCreativeIds({
    accountId: args.accountId,
  });
  if (unknownIds.length === 0) return result;

  const plan = planCreativeFetch({ unknownIds });
  result.creativesPending = plan.deferred;
  let failures = 0;

  /** Tudo que ainda não foi pedido, deste lote em diante. */
  const idsFrom = (index: number) =>
    plan.chunks.slice(index).reduce((total, chunk) => total + chunk.length, 0);

  for (const [index, creativeIds] of plan.chunks.entries()) {
    if (shouldStopForQuota(result.usage)) {
      result.stoppedForQuota = true;
      result.creativesPending += idsFrom(index);
      break;
    }
    if (failures >= MAX_CREATIVE_FETCH_FAILURES) {
      result.creativesPending += idsFrom(index);
      break;
    }

    let creatives: RawCreative[];
    try {
      const fetched = await ports.fetchCreatives({
        accountId: args.accountId,
        credentials: args.credentials,
        creativeIds,
      });
      result.usage = mergeQuotaUsage(result.usage, fetched.usage);
      result.apiCalls += fetched.apiCalls;
      creatives = fetched.creatives;
    } catch (error) {
      // Não sobe: a falha aqui não pode custar a cobertura da conta, e o
      // orquestrador precisa do contador de pendentes para o resumo do run.
      failures += 1;
      result.creativesPending += creativeIds.length;
      result.failureMessage =
        error instanceof Error && error.message
          ? error.message
          : "Erro ao buscar criativos na Meta.";
      continue;
    }

    const rows: CreativeSnapshotRow[] = [];
    for (const node of creatives) {
      const row = toCreativeSnapshotRow({
        accountId: args.accountId,
        node,
      });
      if (row) rows.push(row);
    }

    // Id pedido que não voltou continua pendente: a varredura de amanhã o
    // encontra de novo, e criativo não some sozinho.
    result.creativesPending += creativeIds.length - rows.length;
    if (rows.length > 0) {
      result.creativesFetched += await ports.insertCreatives(rows);
    }
  }

  return result;
}
