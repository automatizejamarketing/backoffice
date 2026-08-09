/**
 * Fixtures da Graph API v25 nos três níveis — campanha, conjunto e anúncio.
 *
 * PROVENIÊNCIA: as formas e os conjuntos de campos vêm das chamadas que este
 * repositório já faz em produção contra a v25 (`app/api/meta-marketing/**`,
 * `lib/meta-business/types.ts`) somadas ao field set do §4.1 do plano
 * `docs/plans/campaign-tracking-foundation.md`. Os valores reproduzem o que a
 * conta real devolve — inclusive os detalhes que só aparecem em resposta de
 * verdade e que quebram normalizador ingênuo:
 *
 * - orçamentos e lance em unidades MENORES, como strings (`"5000"` = R$ 50,00);
 * - `spend_cap: "92233720368547758"`, o sentinela de "sem limite" da Meta;
 * - `lifetime_budget: "0"` quando o orçamento está no outro campo;
 * - `is_adset_budget_sharing_enabled` chegando como boolean;
 * - datas com offset (`-0300`), não ISO com `Z`;
 * - `effective_status` do filho em cascata (`CAMPAIGN_PAUSED`), diferente do
 *   `status` configurado dele;
 * - `learning_stage_info` / `budget_remaining` / `issues_info` variando sozinhos.
 *
 * IDENTIFICADORES SÃO SINTÉTICOS: mesmo formato dos reais (id de campanha com 18
 * dígitos começando em `1202…`), dígitos trocados. Nenhum dado de cliente entra
 * aqui — o nome de campanha segue a convenção de Campanha Gerenciada observada
 * em produção (`[AM][OBJETIVO][NICHO][timestamp]`), com timestamp inventado.
 *
 * Só o teste importa este arquivo.
 */

export const FIXTURE_ACCOUNT_ID = "act_998877665544332";
export const FIXTURE_USER_ID = "3f7c1a52-0d64-4c39-9b1e-2a8f5c6d7e01";
export const FIXTURE_MANAGED_PREFIX = "[AM]";

export const FIXTURE_CAMPAIGN_ID = "120250000000000101";
export const FIXTURE_ADSET_ID = "120250000000000201";
export const FIXTURE_AD_ID = "120250000000000301";
export const FIXTURE_CREATIVE_ID = "120250000000000401";

/** Configuração profunda de campanha (`GET /{campaign-id}?fields=…`). */
export function campaignConfigV25(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: FIXTURE_CAMPAIGN_ID,
    name: "[AM][VENDAS][FS][2026-06-18-19-22-53]",
    status: "ACTIVE",
    effective_status: "ACTIVE",
    objective: "OUTCOME_SALES",
    buying_type: "AUCTION",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    daily_budget: "5000",
    lifetime_budget: "0",
    spend_cap: "92233720368547758",
    budget_remaining: "5000",
    special_ad_categories: [],
    smart_promotion_type: "GUIDED_CREATION",
    advantage_state: "ADVANTAGE_PLUS_SALES",
    is_adset_budget_sharing_enabled: true,
    start_time: "2026-06-18T19:22:53-0300",
    stop_time: "2026-09-18T23:59:59-0300",
    created_time: "2026-06-18T19:22:53-0300",
    updated_time: "2026-08-01T10:12:44-0300",
    ...overrides,
  };
}

/** Configuração profunda de conjunto (`GET /{adset-id}?fields=…`). */
export function adsetConfigV25(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: FIXTURE_ADSET_ID,
    name: "Conjunto — Interesses gastronomia",
    status: "ACTIVE",
    effective_status: "ACTIVE",
    campaign_id: FIXTURE_CAMPAIGN_ID,
    optimization_goal: "OFFSITE_CONVERSIONS",
    billing_event: "IMPRESSIONS",
    bid_amount: "1500",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    destination_type: "WEBSITE",
    daily_budget: "0",
    lifetime_budget: "0",
    budget_remaining: "0",
    start_time: "2026-06-18T19:22:53-0300",
    end_time: "2026-07-18T23:59:59-0300",
    is_dynamic_creative: false,
    targeting: {
      age_min: 25,
      age_max: 65,
      geo_locations: {
        cities: [
          {
            key: "2685",
            name: "Belo Horizonte",
            region: "Minas Gerais",
            region_id: "1996",
            country: "BR",
            radius: 12,
            distance_unit: "kilometer",
          },
        ],
        location_types: ["home", "recent"],
      },
      brand_safety_content_filter_levels: [
        "FACEBOOK_STANDARD",
        "AN_STANDARD",
      ],
      targeting_automation: { advantage_audience: 1 },
      publisher_platforms: ["facebook", "instagram"],
      facebook_positions: ["feed", "video_feeds"],
      instagram_positions: ["stream", "story", "reels"],
    },
    promoted_object: {
      pixel_id: "1122334455667788",
      custom_event_type: "PURCHASE",
    },
    attribution_spec: [
      { event_type: "CLICK_THROUGH", window_days: 7 },
      { event_type: "VIEW_THROUGH", window_days: 1 },
    ],
    pacing_type: ["standard"],
    frequency_control_specs: [],
    learning_stage_info: {
      status: "LEARNING",
      conversions: 3,
      last_sig_edit_ts: 1781000000,
    },
    created_time: "2026-06-18T19:22:54-0300",
    updated_time: "2026-08-01T10:12:45-0300",
    ...overrides,
  };
}

/**
 * Uma linha de insights com `time_increment=1` (`GET /act_…/insights`).
 *
 * O que só aparece em resposta de verdade e quebra parser ingênuo:
 *
 * - **tudo é string**, inclusive contagens inteiras (`impressions: "9432"`);
 * - `spend` e `action_values` em unidades MAIORES da moeda (`"128.47"` = R$
 *   128,47) — ao contrário dos orçamentos da configuração, que vêm em unidades
 *   menores;
 * - `date_start` e `date_stop` iguais, porque o incremento é de um dia;
 * - `cost_per_result` tem forma própria (`indicator` + `values`), diferente das
 *   outras famílias (`action_type` + `value`);
 * - `frequency` com muitas casas decimais.
 *
 * `overrides` entra por cima; passar `undefined` num campo o remove, que é como
 * a Meta se comporta quando a métrica não existe para aquele dia.
 */
export function insightsDayV25(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    date_start: "2026-08-08",
    date_stop: "2026-08-08",
    campaign_id: FIXTURE_CAMPAIGN_ID,
    campaign_name: "[AM][VENDAS][FS][2026-06-18-19-22-53]",
    spend: "128.47",
    impressions: "9432",
    clicks: "212",
    reach: "7781",
    frequency: "1.212183",
    actions: [
      { action_type: "link_click", value: "212" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "7" },
      { action_type: "omni_purchase", value: "7" },
    ],
    action_values: [
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "1394.70" },
      { action_type: "omni_purchase", value: "1394.70" },
    ],
    cost_per_action_type: [
      { action_type: "link_click", value: "0.605990" },
      { action_type: "omni_purchase", value: "18.352857" },
    ],
    cost_per_result: [
      {
        indicator: "actions:offsite_conversion.fb_pixel_purchase",
        values: [{ value: "18.352857", attribution_windows: ["default"] }],
      },
    ],
    purchase_roas: [{ action_type: "omni_purchase", value: "10.856231" }],
    website_purchase_roas: [
      {
        action_type: "offsite_conversion.fb_pixel_purchase",
        value: "10.856231",
      },
    ],
    ...overrides,
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete row[key];
  }

  return row;
}

/**
 * Um evento do audit trail da conta (`GET /act_…/activities`).
 *
 * O que só aparece em resposta de verdade e quebra parser ingênuo:
 *
 * - `extra_data` chega como **string** contendo JSON, não como objeto — e o
 *   conteúdo dela não é documentado pela Meta (pode mudar ou sumir);
 * - `event_time` vem com offset colado (`+0000`), sem os dois pontos do ISO;
 * - `object_id` é o id da entidade no nível em que a ação aconteceu, e é a
 *   única ligação com o resto da fundação — não existe id próprio do evento;
 * - eventos de cobrança e de papéis da conta chegam misturados aos de campanha,
 *   com `object_id` que não corresponde a entidade nenhuma trackeada.
 *
 * `overrides` entra por cima; passar `undefined` num campo o remove.
 */
export function activityV25(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    event_type: "update_campaign_budget",
    translated_event_type: "Orçamento da campanha editado",
    event_time: "2026-08-08T17:33:21+0000",
    actor_id: "10223344556677889",
    actor_name: "Maria Souza",
    application_id: "1122334455667788",
    object_id: FIXTURE_CAMPAIGN_ID,
    object_type: "CAMPAIGN",
    object_name: "[AM][VENDAS][FS][2026-06-18-19-22-53]",
    extra_data: '{"old_value":"5000","new_value":"7000"}',
    ...overrides,
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete row[key];
  }

  return row;
}

/**
 * Um criativo de anúncio (`GET /{creative-id}?fields=…`), o conteúdo que o
 * anúncio mostrava e para onde ele levava.
 *
 * O que só aparece em resposta de verdade e quebra parser ingênuo:
 *
 * - **a URL de promoção muda de lugar conforme o tipo do anúncio**: em anúncio
 *   de link ela é `object_story_spec.link_data.link`; em vídeo, ela só existe
 *   dentro de `call_to_action.value.link`; em Advantage+ ela vira uma LISTA em
 *   `asset_feed_spec.link_urls[].website_url`;
 * - `url_tags` é uma **string** de query string, não um objeto;
 * - `image_hash` e `video_id` se excluem na prática, e o `image_url` do vídeo é
 *   a miniatura, não a mídia;
 * - `effective_object_story_id` tem a forma `{page_id}_{post_id}`.
 *
 * `overrides` entra por cima; passar `undefined` num campo o remove.
 */
export function adCreativeV25(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const node: Record<string, unknown> = {
    id: FIXTURE_CREATIVE_ID,
    name: "Criativo — Vídeo 15s oferta de inverno",
    status: "ACTIVE",
    object_story_spec: {
      page_id: "1122334455667788",
      instagram_user_id: "17841400000000001",
      video_data: {
        video_id: "1029384756473829",
        message: "Últimas unidades da coleção de inverno.",
        title: "Frete grátis acima de R$ 199",
        image_url:
          "https://scontent.xx.fbcdn.net/v/t15.0-10/thumb_120250000000000401.jpg",
        call_to_action: {
          type: "SHOP_NOW",
          value: { link: "https://loja.exemplo.com.br/inverno" },
        },
      },
    },
    degrees_of_freedom_spec: {
      creative_features_spec: {
        standard_enhancements: { enroll_status: "OPT_IN" },
      },
    },
    url_tags: "utm_source=facebook&utm_medium=paid&utm_campaign=inverno",
    call_to_action_type: "SHOP_NOW",
    effective_object_story_id: "1122334455667788_9988776655443322",
    video_id: "1029384756473829",
    instagram_user_id: "17841400000000001",
    actor_id: "1122334455667788",
    ...overrides,
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete node[key];
  }

  return node;
}

/** Configuração profunda de anúncio (`GET /{ad-id}?fields=…`). */
export function adConfigV25(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: FIXTURE_AD_ID,
    name: "Anúncio — Vídeo 15s",
    status: "ACTIVE",
    effective_status: "ACTIVE",
    adset_id: FIXTURE_ADSET_ID,
    campaign_id: FIXTURE_CAMPAIGN_ID,
    creative: { id: FIXTURE_CREATIVE_ID },
    conversion_domain: "loja.exemplo.com.br",
    tracking_specs: [
      {
        "action.type": ["offsite_conversion"],
        fb_pixel: ["1122334455667788"],
      },
    ],
    created_time: "2026-06-18T19:22:56-0300",
    updated_time: "2026-08-01T10:12:46-0300",
    issues_info: [
      {
        level: "AD",
        error_code: 1815869,
        error_summary: "O texto do anúncio tem muitas letras maiúsculas",
        error_type: "SOFT_ERROR",
      },
    ],
    ...overrides,
  };
}
