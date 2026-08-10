/**
 * A promoção das métricas conhecidas a COLUNAS — o único ponto do sistema que
 * sabe qual `action_type` da Meta responde por qual métrica (§4.2 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * ## O contrato de leitura desta fundação
 *
 * **Análise lê colunas; o jsonb cru é reservatório de promoção.** As famílias
 * (`actions`, `action_values`, `cost_per_result`, `purchase_roas`, …) continuam
 * gravadas inteiras e intocadas: elas são o que permite promover uma métrica
 * nova amanhã sobre o histórico de ontem. Mas quem consulta — helper de
 * correlação, tela, consumidor futuro — lê coluna tipada, nunca jsonb. Um campo
 * novo interessante da Meta entra no field set IMEDIATAMENTE, mesmo antes de
 * ganhar coluna: capturar é irreversível no tempo, promover não é.
 *
 * Consequência prática: as listas de prioridade vivem AQUI e em nenhum outro
 * lugar. Antes deste módulo elas estavam duplicadas em `correlation.ts`, e duas
 * cópias da mesma lista significam duas respostas diferentes para "quantas
 * compras houve".
 *
 * ## Semântica do NULL
 *
 * `null` é "a Meta não reportou", nunca "foi zero". Um dia de campanha de
 * mensagens não tem compra, e gravar `0` ali apagaria a diferença entre "não se
 * aplica" e "tentou e não vendeu". O zero-verdadeiro se resolve na leitura,
 * cruzando objetivo e `spend`.
 *
 * ## Unidades
 *
 * `purchase_value` sai de `action_values` e vem em unidades MAIORES da moeda da
 * conta (`"1394.70"` = R$ 1.394,70), igual a `spend`. Os orçamentos das versões
 * de configuração vêm em unidades menores — nunca some os dois sem converter.
 *
 * ## A exceção conhecida
 *
 * Conversões personalizadas (`offsite_conversion.custom.<id>`) têm nome dinâmico
 * por conta: não há coluna possível para elas, e elas seguem legíveis só pelo
 * jsonb cru. É a única exceção prevista ao contrato.
 */

/**
 * As famílias de vídeo do field set. Todas têm a mesma forma
 * (`[{ action_type: "video_view", value }]`), e é por isso que elas cabem num
 * reservatório só (`video_actions` jsonb) em vez de sete colunas jsonb.
 *
 * `video_play_actions` é pedido e guardado sem ter coluna: é o contrato em
 * ação — capturar agora custa uma linha de field set, promover depois custa um
 * `ALTER TABLE`, e não capturar custa o histórico inteiro.
 */
export const VIDEO_INSIGHT_FIELDS = [
  "video_thruplay_watched_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
  "video_avg_time_watched_actions",
  "video_play_actions",
] as const;

/** Escalar, não família: a coluna já é a captura íntegra. */
export const AD_RECALL_INSIGHT_FIELD = "estimated_ad_recallers";

/**
 * O material de onde as colunas saem, no vocabulário da tabela.
 *
 * Os dois caminhos que existem preenchem esta mesma forma: a ESCRITA
 * (`toDailyMetricRows`, a partir da linha crua da Meta) e o BACKFILL (a partir
 * da linha já gravada, cujos campos têm exatamente estes nomes). É isso que faz
 * a extração ter um ponto de verdade só — e o backfill não poder divergir da
 * escrita nem por um `action_type`.
 */
export type MetricColumnSource = {
  /** Unidades MAIORES da moeda da conta. */
  spend?: unknown;
  actions?: unknown;
  actionValues?: unknown;
  costPerResult?: unknown;
  purchaseRoas?: unknown;
  websitePurchaseRoas?: unknown;
  /** Reservatório das famílias de vídeo, chaveado pelo nome do campo da Meta. */
  videoActions?: unknown;
  estimatedAdRecallers?: unknown;
};

/**
 * As métricas conhecidas promovidas a coluna. Contagens são `integer`, dinheiro
 * e razões são `numeric` (STRING de propósito: converter para `number` perderia
 * precisão de dinheiro, e o Postgres aceita o texto como a Meta o escreveu).
 */
export type MetricColumns = {
  // Funil e comércio
  linkClicks: number | null;
  landingPageViews: number | null;
  contentViews: number | null;
  addsToCart: number | null;
  checkoutsInitiated: number | null;
  paymentInfosAdded: number | null;
  purchases: number | null;
  purchaseValue: string | null;
  purchaseRoasValue: string | null;
  // Leads
  leads: number | null;
  registrationsCompleted: number | null;
  // Mensagens
  messagingConversationsStarted: number | null;
  messagingFirstReplies: number | null;
  // Engajamento
  postEngagements: number | null;
  pageEngagements: number | null;
  postReactions: number | null;
  comments: number | null;
  shares: number | null;
  postSaves: number | null;
  pageLikes: number | null;
  // Vídeo
  videoViews3s: number | null;
  thruplays: number | null;
  videoWatchesP25: number | null;
  videoWatchesP50: number | null;
  videoWatchesP75: number | null;
  videoWatchesP95: number | null;
  videoWatchesP100: number | null;
  videoAvgWatchSeconds: string | null;
  // Outros
  estimatedAdRecallers: number | null;
  appInstalls: number | null;
  results: number | null;
  costPerResultValue: string | null;
};

/*
 * As listas de prioridade. A Meta devolve o MESMO fato sob vários
 * `action_type` (o agregado `omni_*`, o do pixel, o clássico): somar dobra o
 * número, então vale o primeiro presente. A ordem é a de
 * `lib/meta-business/transformers.ts` — os painéis de marketing e o tracking
 * precisam contar compra do mesmo jeito, ou o histórico contradiz a tela.
 */

const PURCHASE_ACTION_TYPES = [
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
] as const;

const LINK_CLICK_ACTION_TYPES = ["link_click"] as const;

const LANDING_PAGE_VIEW_ACTION_TYPES = [
  "landing_page_view",
  "onsite_conversion.landing_page_view",
] as const;

const CONTENT_VIEW_ACTION_TYPES = [
  "view_content",
  "omni_view_content",
  "offsite_conversion.fb_pixel_view_content",
] as const;

const ADD_TO_CART_ACTION_TYPES = [
  "add_to_cart",
  "omni_add_to_cart",
  "offsite_conversion.fb_pixel_add_to_cart",
] as const;

const INITIATE_CHECKOUT_ACTION_TYPES = [
  "initiate_checkout",
  "omni_initiated_checkout",
  "offsite_conversion.fb_pixel_initiate_checkout",
] as const;

/** Sem `omni_add_payment_info`: não existe no catálogo de tipos `omni_*`. */
const ADD_PAYMENT_INFO_ACTION_TYPES = [
  "add_payment_info",
  "offsite_conversion.fb_pixel_add_payment_info",
] as const;

/**
 * `complete_registration` NÃO entra aqui, ao contrário de
 * `transformers.ts`: lá ele era substituto de lead porque não havia outra
 * coluna para recebê-lo; aqui `registrations_completed` existe, e misturar os
 * dois faria "leads" mudar de significado conforme a conta.
 */
const LEAD_ACTION_TYPES = [
  "lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
] as const;

const COMPLETE_REGISTRATION_ACTION_TYPES = [
  "complete_registration",
  "omni_complete_registration",
  "offsite_conversion.fb_pixel_complete_registration",
] as const;

const MESSAGING_CONVERSATION_ACTION_TYPES = [
  "onsite_conversion.messaging_conversation_started_7d",
] as const;

const MESSAGING_FIRST_REPLY_ACTION_TYPES = [
  "onsite_conversion.messaging_first_reply",
] as const;

const POST_ENGAGEMENT_ACTION_TYPES = ["post_engagement"] as const;
const PAGE_ENGAGEMENT_ACTION_TYPES = ["page_engagement"] as const;
const POST_REACTION_ACTION_TYPES = ["post_reaction"] as const;
const COMMENT_ACTION_TYPES = ["comment"] as const;
/** Compartilhamento é `post` no vocabulário da Meta, não `share`. */
const SHARE_ACTION_TYPES = ["post"] as const;
const POST_SAVE_ACTION_TYPES = ["onsite_conversion.post_save"] as const;
/** Curtida de PÁGINA (`like`) — reação em post é `post_reaction`. */
const PAGE_LIKE_ACTION_TYPES = ["like"] as const;

/** Visualização de 3 s; o ThruPlay tem família própria. */
const VIDEO_VIEW_ACTION_TYPES = ["video_view"] as const;

const APP_INSTALL_ACTION_TYPES = [
  "mobile_app_install",
  "omni_app_install",
  "app_install",
] as const;

/** O ROAS reportado, na mesma prioridade das compras. */
const ROAS_ACTION_TYPES = PURCHASE_ACTION_TYPES;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Texto utilizável, ou `null`. Tudo na resposta de insights chega como string. */
function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "string" ? value.trim() : String(value);
  return raw.length > 0 ? raw : null;
}

/**
 * Contagem inteira, ARREDONDADA (não truncada): a Meta divide um evento entre
 * janelas de atribuição e às vezes devolve `"6.9998"` — truncar subestimaria a
 * entrega em silêncio. Difere de propósito do `count()` de `daily-metrics.ts`,
 * que trata de contadores que a Meta sempre manda inteiros (impressões,
 * cliques).
 */
function countOf(value: unknown): number | null {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/** Decimal destinado a coluna `numeric`: fica string para não perder precisão. */
function decimalOf(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  return Number.isFinite(Number(raw)) ? raw : null;
}

/** Número para CONTA (divisão, multiplicação) — nunca para gravar em coluna. */
function numberOf(value: unknown): number | null {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `numeric` a partir de um número calculado, sem notação científica nem lixo. */
function decimalFrom(value: number): string {
  const fixed = value.toFixed(6);
  return fixed.includes(".")
    ? fixed.replace(/0+$/, "").replace(/\.$/, "")
    : fixed;
}

/**
 * O valor bruto do primeiro `action_type` da lista de prioridade presente na
 * família — a regra que impede a dupla contagem.
 */
function familyValue(
  family: unknown,
  actionTypes: readonly string[],
): string | null {
  if (!Array.isArray(family)) return null;
  for (const actionType of actionTypes) {
    const hit = family.find(
      (entry) => isRecord(entry) && entry.action_type === actionType,
    );
    if (isRecord(hit)) {
      const value = text(hit.value);
      if (value !== null) return value;
    }
  }
  return null;
}

/**
 * O valor da primeira entrada utilizável, sem olhar `action_type`. É o que as
 * famílias de vídeo pedem: elas têm uma entrada só (`video_view`), e amarrar a
 * leitura ao nome do tipo quebraria se a Meta renomeá-lo.
 */
function firstFamilyValue(family: unknown): string | null {
  if (!Array.isArray(family)) return null;
  for (const entry of family) {
    if (!isRecord(entry)) continue;
    const value = text(entry.value);
    if (value !== null) return value;
  }
  return null;
}

/** Uma família de vídeo dentro do reservatório. */
function videoFamily(videoActions: unknown, field: string): unknown {
  return isRecord(videoActions) ? videoActions[field] : null;
}

/**
 * `cost_per_result` tem forma própria: `{ indicator, values: [{ value }] }`, em
 * vez do `{ action_type, value }` das outras famílias — e algumas respostas
 * antigas usam a forma plana. Os dois casos são lidos, e o `indicator` é o que
 * NOMEIA o resultado da conta (`"actions:link_click"`).
 */
function readCostPerResult(family: unknown): {
  indicator: string | null;
  value: string | null;
} {
  if (!Array.isArray(family)) return { indicator: null, value: null };

  for (const entry of family) {
    if (!isRecord(entry)) continue;
    const value =
      text(entry.value) ??
      (Array.isArray(entry.values) ? firstFamilyValue(entry.values) : null);
    if (value === null) continue;
    return {
      indicator: text(entry.indicator) ?? text(entry.action_type),
      value,
    };
  }

  return { indicator: null, value: null };
}

/**
 * Quantos resultados o dia produziu, na definição de resultado da PRÓPRIA conta.
 *
 * A Meta não devolve `results` como campo pedível numa consulta de insights
 * comum, mas devolve `cost_per_result` — e o `indicator` dele nomeia o
 * `action_type` que a conta considera resultado. Daí as duas regras, nesta
 * ordem:
 *
 * 1. **Contar** esse `action_type` em `actions`. É exato e inteiro.
 * 2. **Dividir** `spend ÷ cost_per_result`. Vale quando o resultado não é uma
 *    ação (alcance, impressões) ou quando o tipo não veio em `actions`; é
 *    aritmeticamente o mesmo número, com o arredondamento que a precisão do
 *    custo permitir.
 *
 * `null` quando nenhuma das duas se aplica — inderivável não é zero.
 */
function deriveResults(args: {
  actions: unknown;
  spend: unknown;
  costPerResult: { indicator: string | null; value: string | null };
}): number | null {
  const { indicator, value } = args.costPerResult;

  if (indicator !== null) {
    // "actions:link_click" ⇒ "link_click"; um indicator sem prefixo é o
    // próprio action_type (a forma plana).
    const actionType = indicator.includes(":")
      ? indicator.slice(indicator.indexOf(":") + 1)
      : indicator;
    const counted = familyValue(args.actions, [actionType]);
    if (counted !== null) return countOf(counted);
  }

  const costPerResult = numberOf(value);
  const spend = numberOf(args.spend);
  if (
    costPerResult !== null &&
    costPerResult > 0 &&
    spend !== null &&
    spend > 0
  ) {
    return Math.round(spend / costPerResult);
  }

  return null;
}

/**
 * O valor de compra do dia.
 *
 * Prefere `action_values`. Quando a conta não reporta valores mas reporta ROAS
 * — acontece, e não é raro —, o valor é RECONSTRUÍDO como `roas × spend`. Esse
 * fallback nasceu na leitura (ticket 08, `insightsToWindowMetrics`) e mudou de
 * casa para cá de propósito: reconstruir a cada consulta significaria cada
 * consumidor reconstruindo à sua maneira, e a coluna existe justamente para que
 * a resposta seja uma só. Sem gasto não há reconstrução possível — `null`.
 */
function derivePurchaseValue(args: {
  actionValues: unknown;
  purchaseRoas: string | null;
  spend: unknown;
}): string | null {
  const reported = decimalOf(familyValue(args.actionValues, PURCHASE_ACTION_TYPES));
  if (reported !== null && Number(reported) > 0) return reported;

  const roas = numberOf(args.purchaseRoas);
  const spend = numberOf(args.spend);
  if (roas !== null && roas > 0 && spend !== null && spend > 0) {
    return decimalFrom(roas * spend);
  }

  return reported;
}

/** As métricas conhecidas de um dia, extraídas uma única vez, na escrita. */
export function extractMetricColumns(
  source: MetricColumnSource,
): MetricColumns {
  const { actions, actionValues, videoActions, spend } = source;
  const costPerResult = readCostPerResult(source.costPerResult);
  const purchaseRoas =
    familyValue(source.purchaseRoas, ROAS_ACTION_TYPES) ??
    familyValue(source.websitePurchaseRoas, ROAS_ACTION_TYPES);

  return {
    linkClicks: countOf(familyValue(actions, LINK_CLICK_ACTION_TYPES)),
    landingPageViews: countOf(
      familyValue(actions, LANDING_PAGE_VIEW_ACTION_TYPES),
    ),
    contentViews: countOf(familyValue(actions, CONTENT_VIEW_ACTION_TYPES)),
    addsToCart: countOf(familyValue(actions, ADD_TO_CART_ACTION_TYPES)),
    checkoutsInitiated: countOf(
      familyValue(actions, INITIATE_CHECKOUT_ACTION_TYPES),
    ),
    paymentInfosAdded: countOf(
      familyValue(actions, ADD_PAYMENT_INFO_ACTION_TYPES),
    ),
    purchases: countOf(familyValue(actions, PURCHASE_ACTION_TYPES)),
    purchaseValue: derivePurchaseValue({ actionValues, purchaseRoas, spend }),
    purchaseRoasValue: decimalOf(purchaseRoas),

    leads: countOf(familyValue(actions, LEAD_ACTION_TYPES)),
    registrationsCompleted: countOf(
      familyValue(actions, COMPLETE_REGISTRATION_ACTION_TYPES),
    ),

    messagingConversationsStarted: countOf(
      familyValue(actions, MESSAGING_CONVERSATION_ACTION_TYPES),
    ),
    messagingFirstReplies: countOf(
      familyValue(actions, MESSAGING_FIRST_REPLY_ACTION_TYPES),
    ),

    postEngagements: countOf(familyValue(actions, POST_ENGAGEMENT_ACTION_TYPES)),
    pageEngagements: countOf(familyValue(actions, PAGE_ENGAGEMENT_ACTION_TYPES)),
    postReactions: countOf(familyValue(actions, POST_REACTION_ACTION_TYPES)),
    comments: countOf(familyValue(actions, COMMENT_ACTION_TYPES)),
    shares: countOf(familyValue(actions, SHARE_ACTION_TYPES)),
    postSaves: countOf(familyValue(actions, POST_SAVE_ACTION_TYPES)),
    pageLikes: countOf(familyValue(actions, PAGE_LIKE_ACTION_TYPES)),

    videoViews3s: countOf(familyValue(actions, VIDEO_VIEW_ACTION_TYPES)),
    thruplays: countOf(
      firstFamilyValue(
        videoFamily(videoActions, "video_thruplay_watched_actions"),
      ),
    ),
    videoWatchesP25: countOf(
      firstFamilyValue(videoFamily(videoActions, "video_p25_watched_actions")),
    ),
    videoWatchesP50: countOf(
      firstFamilyValue(videoFamily(videoActions, "video_p50_watched_actions")),
    ),
    videoWatchesP75: countOf(
      firstFamilyValue(videoFamily(videoActions, "video_p75_watched_actions")),
    ),
    videoWatchesP95: countOf(
      firstFamilyValue(videoFamily(videoActions, "video_p95_watched_actions")),
    ),
    videoWatchesP100: countOf(
      firstFamilyValue(videoFamily(videoActions, "video_p100_watched_actions")),
    ),
    videoAvgWatchSeconds: decimalOf(
      firstFamilyValue(
        videoFamily(videoActions, "video_avg_time_watched_actions"),
      ),
    ),

    estimatedAdRecallers: countOf(source.estimatedAdRecallers),
    appInstalls: countOf(familyValue(actions, APP_INSTALL_ACTION_TYPES)),
    results: deriveResults({ actions, spend, costPerResult }),
    costPerResultValue: decimalOf(costPerResult.value),
  };
}

/**
 * Um lote da promoção retroativa: cada linha já gravada vira um UPDATE, e o
 * cursor é o id da última linha do lote.
 *
 * As duas propriedades que o script depende estão aqui, e é por isso que elas
 * têm teste:
 *
 * - **Retomável.** O cursor é keyset por `id`; retomar de onde parou é passar o
 *   último cursor de volta. Não dá para filtrar "linhas ainda não promovidas"
 *   porque coluna nula é resposta legítima (dia de alcance não tem compra), e
 *   um filtro assim reprocessaria essas linhas para sempre.
 * - **Idempotente.** Nenhuma linha é pulada e a extração é determinística:
 *   rodar duas vezes escreve exatamente os mesmos valores.
 */
export function planMetricColumnPromotion<
  R extends { id: string } & MetricColumnSource,
>(
  rows: readonly R[],
): {
  updates: Array<{ id: string; columns: MetricColumns }>;
  nextCursor: string | null;
} {
  return {
    updates: rows.map((row) => ({
      id: row.id,
      columns: extractMetricColumns(row),
    })),
    nextCursor: rows.length > 0 ? rows[rows.length - 1].id : null,
  };
}

/**
 * A linha crua da Meta traduzida para o vocabulário da tabela — o passo que a
 * ESCRITA dá antes de extrair (o backfill não precisa dele: a linha gravada já
 * está neste vocabulário).
 *
 * As famílias de vídeo são recolhidas num objeto só, que vai para o jsonb
 * `video_actions`. É o reservatório delas: sem ele, promover "quantas pessoas
 * assistiram 50% em cada tipo de posicionamento" amanhã exigiria uma coleta que
 * a janela de 37 meses da Meta já teria levado embora.
 */
export function metricColumnSourceFromInsightsRow(
  raw: Record<string, unknown>,
): MetricColumnSource {
  let videoActions: Record<string, unknown> | null = null;
  for (const field of VIDEO_INSIGHT_FIELDS) {
    const value = raw[field];
    if (value === null || value === undefined) continue;
    videoActions ??= {};
    videoActions[field] = value;
  }

  return {
    spend: raw.spend,
    actions: raw.actions,
    actionValues: raw.action_values,
    costPerResult: raw.cost_per_result,
    purchaseRoas: raw.purchase_roas,
    websitePurchaseRoas: raw.website_purchase_roas,
    videoActions,
    estimatedAdRecallers: raw[AD_RECALL_INSIGHT_FIELD],
  };
}
