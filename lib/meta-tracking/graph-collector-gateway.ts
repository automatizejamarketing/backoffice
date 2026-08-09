/**
 * A conversa do coletor com a Graph API v25 (§5.1–5.2 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Executor fino: monta URL, pagina, lê os headers de uso e devolve dados crus.
 * Nenhuma decisão mora aqui — quem escolhe o que buscar é `planDeepFetch`, quem
 * decide parar é `shouldStopForQuota`, quem interpreta a resposta é a costura do
 * delta. Por isso este arquivo não tem teste unitário: não há o que testar sem
 * a Meta do outro lado, e o que valeria a pena testar já foi extraído daqui.
 *
 * ## Por que não reusar `metaApiCall`
 *
 * `metaApiCall` devolve só o corpo, e a postura de cota desta fundação depende
 * dos HEADERS de resposta (`X-Business-Use-Case-Usage` e companhia) mesmo
 * quando a chamada dá certo — que é justamente quando ainda dá para parar sem
 * gerar erro. O resto (versão da API, `appsecret_proof`, `Authorization`,
 * `GraphApiError`, log observável) é o mesmo, importado dos mesmos módulos.
 *
 * ## O que se pede à Meta, e por quê
 *
 * - **Listagem** (`/campaigns`, `/adsets`, `/ads`): id, hierarquia, status,
 *   estado efetivo e `updated_time`. Barata, cobre TODAS as entidades — é a
 *   única fonte de ciclo de vida — e pede explicitamente arquivadas e removidas,
 *   sem o que o edge as omite e a remoção nunca seria reportada.
 * - **Fetch profundo** (`?ids=…&fields=…`): o field set do §4.1, só para quem
 *   está entregando, em lotes de 50 (teto do node batch).
 * - **Insights** (`/insights?level=…&time_increment=1`): a série diária do §4.2,
 *   com a atribuição unificada do conjunto para que os números batam com o
 *   Gerenciador de Anúncios. Sem breakdowns nesta fundação.
 */

import { graphApiVersion, graphFacebookBaseUrl } from "@/lib/meta-business/constant";
import {
  appSecretProofParam,
  facebookAppSecret,
} from "@/lib/meta-business/appsecret-proof";
import { GraphApiError, genericError, parseGraphError } from "@/lib/meta-business/error";
import { logMetaCall } from "@/lib/observability/meta-logger";
import {
  DEEP_FETCH_CHUNK_SIZE,
  LISTING_EFFECTIVE_STATUSES,
  type DeepFetchChunk,
  type ListedEntity,
} from "@/lib/meta-tracking/daily-collection-plan";
import {
  mergeQuotaUsage,
  readQuotaUsage,
  shouldStopForQuota,
  UNKNOWN_QUOTA_USAGE,
  type QuotaUsage,
} from "@/lib/meta-tracking/quota-usage";
import {
  isInsightsRowLimitError,
  type InsightsRange,
  type RawInsightsRow,
} from "@/lib/meta-tracking/daily-metrics";
import type { InsightsFetchResult } from "@/lib/meta-tracking/collect-daily-metrics";
import type { TrackingConfigObservation } from "@/lib/meta-tracking/compute-tracking-delta";
import type {
  TrackedAdAccount,
  TrackingCredentials,
} from "@/lib/meta-tracking/run-daily-collection";
import type { MetaTrackingEntityLevel } from "@/lib/db/schema";

/** Entidades por página da listagem. */
const LISTING_PAGE_LIMIT = 200;

/**
 * Teto de páginas por nível. Uma conta com mais anúncios do que isso ficaria com
 * listagem truncada — que a costura do delta trata sem inventar remoção — e o
 * caso vira problema de operação, não de dados errados.
 */
const MAX_LISTING_PAGES = 25;

/** Campos da listagem, por nível. O `updated_time` alimenta o pré-filtro. */
const LISTING_FIELDS: Record<MetaTrackingEntityLevel, string> = {
  campaign: "id,name,status,effective_status,updated_time",
  adset: "id,name,status,effective_status,campaign_id,updated_time",
  ad: "id,name,status,effective_status,campaign_id,adset_id,updated_time",
};

const LISTING_EDGE: Record<MetaTrackingEntityLevel, string> = {
  campaign: "campaigns",
  adset: "adsets",
  ad: "ads",
};

/**
 * Field set profundo do §4.1 do plano: colunas tipadas + voláteis + tudo que
 * vai íntegro para o `config` jsonb.
 */
const DEEP_FETCH_FIELDS: Record<MetaTrackingEntityLevel, string> = {
  campaign: [
    "id",
    "name",
    "status",
    "effective_status",
    "objective",
    "buying_type",
    "bid_strategy",
    "daily_budget",
    "lifetime_budget",
    "spend_cap",
    "budget_remaining",
    "special_ad_categories",
    "smart_promotion_type",
    // Os dois: a coluna tipada lê o primeiro, o segundo fica no `config`
    // jsonb até alguém ver a forma real dele numa resposta de verdade.
    "advantage_state",
    "advantage_state_info",
    "is_adset_budget_sharing_enabled",
    "start_time",
    "stop_time",
    "created_time",
    "updated_time",
    "issues_info",
  ].join(","),
  adset: [
    "id",
    "name",
    "status",
    "effective_status",
    "campaign_id",
    "optimization_goal",
    "billing_event",
    "bid_amount",
    "bid_strategy",
    "destination_type",
    "daily_budget",
    "lifetime_budget",
    "budget_remaining",
    "start_time",
    "end_time",
    "is_dynamic_creative",
    "targeting",
    "promoted_object",
    "attribution_spec",
    "frequency_control_specs",
    "pacing_type",
    "dsa_beneficiary",
    "dsa_payor",
    "learning_stage_info",
    "issues_info",
    "created_time",
    "updated_time",
  ].join(","),
  ad: [
    "id",
    "name",
    "status",
    "effective_status",
    "campaign_id",
    "adset_id",
    "creative{id}",
    "conversion_domain",
    "tracking_specs",
    "issues_info",
    "created_time",
    "updated_time",
  ].join(","),
};

/**
 * Field set de recuo, com os campos que existem desde sempre.
 *
 * A Marketing API rejeita a requisição INTEIRA quando um único campo do
 * `fields` não existe naquele nível (erro 100), e a versão da API muda o
 * catálogo sem aviso. Perder o dia inteiro de uma conta por causa de um campo
 * novo seria pior do que gravar a configuração essencial: no recuo, o que
 * sobra ainda entra no `config` jsonb e nas colunas quentes.
 */
const DEEP_FETCH_CORE_FIELDS: Record<MetaTrackingEntityLevel, string> = {
  campaign:
    "id,name,status,effective_status,objective,buying_type,bid_strategy,daily_budget,lifetime_budget,spend_cap,budget_remaining,special_ad_categories,start_time,stop_time,created_time,updated_time",
  adset:
    "id,name,status,effective_status,campaign_id,optimization_goal,billing_event,bid_amount,bid_strategy,destination_type,daily_budget,lifetime_budget,budget_remaining,start_time,end_time,targeting,promoted_object,attribution_spec,created_time,updated_time",
  ad: "id,name,status,effective_status,campaign_id,adset_id,creative{id},conversion_domain,tracking_specs,created_time,updated_time",
};

/** Erro de parâmetro inválido da Meta — o sintoma de campo inexistente. */
const INVALID_PARAMETER_ERROR_CODE = 100;

function isInvalidParameterError(error: unknown): boolean {
  return (
    error instanceof GraphApiError &&
    error.errorReturn.data?.code === INVALID_PARAMETER_ERROR_CODE
  );
}

function accountPath(accountId: string): string {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

type GraphResponse<T> = { json: T; usage: QuotaUsage };

/**
 * Um GET na Graph API que também devolve a leitura de cota dos headers — o
 * ponto inteiro deste módulo. Erros viram `GraphApiError`, como no resto do
 * projeto, para que a rota e o log tratem tudo de um jeito só.
 */
async function graphGet<T>(args: {
  path: string;
  params: string;
  accessToken: string;
}): Promise<GraphResponse<T>> {
  const proof = appSecretProofParam(args.accessToken, facebookAppSecret());
  const query = [args.params, proof].filter(Boolean).join("&");
  const endpoint = `${graphFacebookBaseUrl}/${graphApiVersion}/${args.path}`;
  const startedAt = Date.now();

  const response = await fetch(`${endpoint}?${query}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${args.accessToken}` },
  });
  const usage = readQuotaUsage(response.headers);
  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    logMetaCall({
      phase: "error",
      method: "GET",
      endpoint,
      requestParams: args.params,
      httpStatus: response.status,
      durationMs,
      errorData: payload,
    });
    const parsed = payload ? parseGraphError(payload) : undefined;
    throw new GraphApiError(
      parsed?.data
        ? parsed
        : { statusCode: response.status, reason: genericError },
    );
  }

  const json = (await response.json()) as T;
  logMetaCall({
    phase: "success",
    method: "GET",
    endpoint,
    requestParams: args.params,
    httpStatus: response.status,
    durationMs,
  });

  return { json, usage };
}

type GraphPage<T> = {
  data?: T[];
  paging?: { next?: string; cursors?: { after?: string } };
};

type ListedNode = {
  id: string;
  name?: string | null;
  status?: string | null;
  effective_status?: string | null;
  campaign_id?: string | null;
  adset_id?: string | null;
  updated_time?: string | null;
};

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toListedEntity(
  entityLevel: MetaTrackingEntityLevel,
  node: ListedNode,
): ListedEntity {
  return {
    entityLevel,
    entityId: String(node.id),
    name: node.name ?? null,
    campaignId: entityLevel === "campaign" ? null : (node.campaign_id ?? null),
    adsetId: entityLevel === "ad" ? (node.adset_id ?? null) : null,
    status: node.status ?? null,
    effectiveStatus: node.effective_status ?? null,
    updatedTime: toDate(node.updated_time),
  };
}

/**
 * Contas de anúncio atribuídas ao usuário, com moeda e timezone — a timezone é
 * o que define o "dia" da cobertura e da série diária, e a Meta só a entrega no
 * nó da conta. Um node batch resolve todas de uma vez.
 */
export async function fetchTrackedAdAccounts(args: {
  accountIds: readonly string[];
  credentials: TrackingCredentials;
}): Promise<{ accounts: TrackedAdAccount[]; usage: QuotaUsage; apiCalls: number }> {
  if (args.accountIds.length === 0) {
    return { accounts: [], usage: UNKNOWN_QUOTA_USAGE, apiCalls: 0 };
  }

  const accounts: TrackedAdAccount[] = [];
  let usage = UNKNOWN_QUOTA_USAGE;
  let apiCalls = 0;

  for (let i = 0; i < args.accountIds.length; i += DEEP_FETCH_CHUNK_SIZE) {
    const ids = args.accountIds
      .slice(i, i + DEEP_FETCH_CHUNK_SIZE)
      .map(accountPath);
    const params = new URLSearchParams({
      ids: ids.join(","),
      fields: "id,name,currency,timezone_name,account_status",
    });

    const { json, usage: pageUsage } = await graphGet<
      Record<
        string,
        {
          id?: string;
          name?: string | null;
          currency?: string | null;
          timezone_name?: string | null;
        }
      >
    >({
      path: "",
      params: params.toString(),
      accessToken: args.credentials.accessToken,
    });
    usage = mergeQuotaUsage(usage, pageUsage);
    apiCalls += 1;

    for (const [key, node] of Object.entries(json ?? {})) {
      accounts.push({
        accountId: accountPath(node?.id ?? key),
        name: node?.name ?? null,
        currency: node?.currency ?? null,
        timezoneName: node?.timezone_name ?? null,
      });
    }
  }

  return { accounts, usage, apiCalls };
}

/**
 * A listagem completa da conta nos três níveis. Pede explicitamente todos os
 * estados efetivos documentados do nível: sem isso o edge omite arquivadas e
 * removidas, e o arquivamento — que é fim de linha e precisa entrar no stream —
 * nunca seria observado.
 */
export async function listTrackedEntities(args: {
  accountId: string;
  credentials: TrackingCredentials;
}): Promise<{ entities: ListedEntity[]; usage: QuotaUsage; apiCalls: number }> {
  const entities: ListedEntity[] = [];
  let usage = UNKNOWN_QUOTA_USAGE;
  let apiCalls = 0;

  for (const entityLevel of [
    "campaign",
    "adset",
    "ad",
  ] as MetaTrackingEntityLevel[]) {
    let after: string | undefined;
    let pages = 0;

    do {
      const params = new URLSearchParams({
        fields: LISTING_FIELDS[entityLevel],
        limit: String(LISTING_PAGE_LIMIT),
        effective_status: JSON.stringify([
          ...LISTING_EFFECTIVE_STATUSES[entityLevel],
        ]),
      });
      if (after) params.set("after", after);

      const { json, usage: pageUsage } = await graphGet<GraphPage<ListedNode>>({
        path: `${accountPath(args.accountId)}/${LISTING_EDGE[entityLevel]}`,
        params: params.toString(),
        accessToken: args.credentials.accessToken,
      });
      usage = mergeQuotaUsage(usage, pageUsage);
      apiCalls += 1;
      pages += 1;

      for (const node of json.data ?? []) {
        entities.push(toListedEntity(entityLevel, node));
      }

      after = json.paging?.next ? json.paging.cursors?.after : undefined;
    } while (after && pages < MAX_LISTING_PAGES);
  }

  return { entities, usage, apiCalls };
}

/**
 * O fetch profundo dos lotes que o plano escolheu.
 *
 * Interrompe ANTES de estourar a cota da conta: entre um lote e outro, se os
 * headers da Meta já indicarem aperto, devolve o que tem com
 * `stoppedForQuota` — a conta fica com cobertura `partial` e o próximo disparo
 * do cron termina. Tomar 429 custa mais caro que um dia parcial: a licença do
 * app é throttled por taxa de erro.
 */
export async function fetchTrackedConfigs(args: {
  accountId: string;
  credentials: TrackingCredentials;
  chunks: readonly DeepFetchChunk[];
  usage?: QuotaUsage;
}): Promise<{
  configs: TrackingConfigObservation[];
  usage: QuotaUsage;
  apiCalls: number;
  stoppedForQuota: boolean;
}> {
  const configs: TrackingConfigObservation[] = [];
  let usage = args.usage ?? UNKNOWN_QUOTA_USAGE;
  let apiCalls = 0;

  for (const chunk of args.chunks) {
    if (shouldStopForQuota(usage)) {
      return { configs, usage, apiCalls, stoppedForQuota: true };
    }
    if (chunk.entityIds.length === 0) continue;

    const request = async (fields: string) =>
      graphGet<Record<string, Record<string, unknown>>>({
        path: "",
        params: new URLSearchParams({
          ids: chunk.entityIds.join(","),
          fields,
        }).toString(),
        accessToken: args.credentials.accessToken,
      });

    let response: GraphResponse<Record<string, Record<string, unknown>>>;
    try {
      response = await request(DEEP_FETCH_FIELDS[chunk.entityLevel]);
      apiCalls += 1;
    } catch (error) {
      if (!isInvalidParameterError(error)) throw error;
      apiCalls += 1;
      // Um campo do catálogo mudou: salva o essencial em vez de perder o dia.
      console.warn(
        `[meta-tracking] field set rejeitado em ${chunk.entityLevel}; recuando para o essencial`,
        error instanceof Error ? error.message : error,
      );
      response = await request(DEEP_FETCH_CORE_FIELDS[chunk.entityLevel]);
      apiCalls += 1;
    }

    usage = mergeQuotaUsage(usage, response.usage);
    for (const [entityId, config] of Object.entries(response.json ?? {})) {
      if (!config || typeof config !== "object") continue;
      configs.push({
        entityLevel: chunk.entityLevel,
        entityId: String((config as { id?: unknown }).id ?? entityId),
        config,
      });
    }
  }

  return { configs, usage, apiCalls, stoppedForQuota: false };
}

/** Linhas de insights por página. Acima disso a Meta costuma truncar sozinha. */
const INSIGHTS_PAGE_LIMIT = 500;

/**
 * Teto de páginas por nível e período. Conta que passe disso já teria estourado
 * o teto de linhas do relatório muito antes — o recuo por volume (o fatiamento
 * do período) é que resolve o caso, não mais paginação.
 */
const MAX_INSIGHTS_PAGES = 100;

/**
 * O que identifica a entidade em cada nível. Pedido explicitamente porque é a
 * chave da linha: sem ele a série não tem a que se ligar.
 */
const INSIGHTS_ID_FIELDS: Record<MetaTrackingEntityLevel, readonly string[]> = {
  campaign: ["campaign_id"],
  adset: ["campaign_id", "adset_id"],
  ad: ["campaign_id", "adset_id", "ad_id"],
};

/** Numéricos universais + as famílias de cardinalidade variável do §4.2. */
const INSIGHTS_METRIC_FIELDS: readonly string[] = [
  "spend",
  "impressions",
  "clicks",
  "reach",
  "frequency",
  "actions",
  "action_values",
  "cost_per_action_type",
  "cost_per_result",
  "purchase_roas",
  "website_purchase_roas",
  "date_start",
  "date_stop",
];

/**
 * Field set de recuo — mesma postura do fetch profundo: um campo que saiu do
 * catálogo derruba a requisição INTEIRA (erro 100), e perder o dia da conta é
 * pior do que gravar a série sem uma família.
 *
 * Sai só `cost_per_result`: é o único que depende da configuração de resultado
 * da conta em vez de existir sempre. Os demais são antigos e estáveis, e
 * removê-los "por precaução" seria jogar fora dado bom.
 */
const INSIGHTS_CORE_METRIC_FIELDS: readonly string[] =
  INSIGHTS_METRIC_FIELDS.filter((field) => field !== "cost_per_result");

/**
 * A série diária de um nível num período (§5.6 do plano).
 *
 * `time_increment=1` é o que torna a persistência por dia possível — qualquer
 * janela de análise é derivada por consulta, nunca armazenada.
 * `use_unified_attribution_setting=true` faz a Meta responder com a mesma
 * configuração de atribuição do conjunto, que é a que o Gerenciador de Anúncios
 * mostra; sem isso os números do histórico não bateriam com o que o cliente vê.
 *
 * Erro de volume de linhas sobe intocado: quem sabe encolher o período é o passo
 * (`collect-daily-metrics.ts`), não este executor.
 */
export async function fetchAccountInsights(args: {
  accountId: string;
  credentials: TrackingCredentials;
  entityLevel: MetaTrackingEntityLevel;
  range: InsightsRange;
}): Promise<InsightsFetchResult> {
  let usage = UNKNOWN_QUOTA_USAGE;
  let apiCalls = 0;

  const fetchAllPages = async (
    metricFields: readonly string[],
  ): Promise<RawInsightsRow[]> => {
    const fields = [
      ...INSIGHTS_ID_FIELDS[args.entityLevel],
      ...metricFields,
    ].join(",");
    const rows: RawInsightsRow[] = [];
    let after: string | undefined;
    let pages = 0;

    do {
      const params = new URLSearchParams({
        level: args.entityLevel,
        fields,
        time_increment: "1",
        time_range: JSON.stringify(args.range),
        use_unified_attribution_setting: "true",
        limit: String(INSIGHTS_PAGE_LIMIT),
      });
      if (after) params.set("after", after);

      const { json, usage: pageUsage } = await graphGet<
        GraphPage<RawInsightsRow>
      >({
        path: `${accountPath(args.accountId)}/insights`,
        params: params.toString(),
        accessToken: args.credentials.accessToken,
      });
      usage = mergeQuotaUsage(usage, pageUsage);
      apiCalls += 1;
      pages += 1;

      rows.push(...(json.data ?? []));
      after = json.paging?.next ? json.paging.cursors?.after : undefined;
    } while (after && pages < MAX_INSIGHTS_PAGES);

    return rows;
  };

  try {
    const rows = await fetchAllPages(INSIGHTS_METRIC_FIELDS);
    return { rows, usage, apiCalls };
  } catch (error) {
    // Volume de linhas é do passo, não deste recuo — e os dois chegam como
    // erro 100, então a ordem destas duas guardas é o que faz o fatiamento
    // acontecer em vez de virar uma consulta sem as famílias de custo.
    if (isInsightsRowLimitError(error) || !isInvalidParameterError(error)) {
      throw error;
    }
    console.warn(
      `[meta-tracking] field set de insights rejeitado em ${args.entityLevel}; recuando para o essencial`,
      error instanceof Error ? error.message : error,
    );
    const rows = await fetchAllPages(INSIGHTS_CORE_METRIC_FIELDS);
    return { rows, usage, apiCalls };
  }
}
