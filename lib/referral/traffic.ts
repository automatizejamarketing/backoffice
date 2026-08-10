// Classificação de tráfego dos Cliques do programa de afiliados v2.
//
// O painel de tráfego responde "por onde os afiliados divulgam?", e a resposta
// vem de três testemunhas gravadas no Clique, nenhuma delas completa:
//
//   * `landing_url` carrega a query string da chegada (`?src=`, `utm_*`) — a
//     origem DECLARADA pelo próprio afiliado no link que ele divulgou. É a
//     única testemunha capaz de nomear WhatsApp, newsletter ou QR code.
//   * `referrer_url` diz qual site linkou. Apps de mensagem não mandam Referer,
//     então a ausência dele não significa tráfego direto de verdade.
//   * `user_agent` diz qual app renderizou o clique — o navegador embutido do
//     Instagram/Facebook/TikTok se identifica nele mesmo sem Referer.
//
// A precedência é declarada > referrer > user-agent: quem nomeou o canal no
// link sabe mais que o header, e o header sabe mais que o app. Antes de tudo,
// porém, o clique passa pelo detector de robôs de preview — o servidor do
// WhatsApp busca toda URL colada numa conversa para montar o card, e esse
// fetch chega aqui como um "clique" que nenhuma pessoa deu. Contá-lo junto
// inflaria exatamente a métrica que o painel existe para tornar honesta.
//
// Módulo puro de ponta a ponta: nada aqui toca banco ou relógio. Quem busca as
// linhas é `traffic-queries.ts`; este arquivo só decide.

/** Fontes conhecidas — as que ganham logo no painel. */
export const REFERRAL_TRAFFIC_SOURCE_VALUES = [
  "instagram",
  "facebook",
  "whatsapp",
  "google",
  "bing",
  "tiktok",
  "youtube",
  "telegram",
  "x",
  "linkedin",
  "kwai",
  "direct",
  "other",
] as const;

export type ReferralTrafficSource =
  (typeof REFERRAL_TRAFFIC_SOURCE_VALUES)[number];

export const REFERRAL_TRAFFIC_SOURCE_LABELS: Record<
  ReferralTrafficSource,
  string
> = {
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  google: "Google",
  bing: "Bing",
  tiktok: "TikTok",
  youtube: "YouTube",
  telegram: "Telegram",
  x: "X (Twitter)",
  linkedin: "LinkedIn",
  kwai: "Kwai",
  direct: "Direto",
  other: "Outros sites",
};

/**
 * Apelidos aceitos no `?src=` / `utm_source=`. O afiliado escreve como quiser;
 * os apelidos comuns caem na fonte com logo, e um valor desconhecido vira uma
 * fonte própria com o nome que ele deu — um canal que ele inventou ("blog-ana")
 * é informação, não erro.
 */
const DECLARED_SOURCE_ALIASES: Record<string, ReferralTrafficSource> = {
  whatsapp: "whatsapp",
  wa: "whatsapp",
  wpp: "whatsapp",
  zap: "whatsapp",
  instagram: "instagram",
  ig: "instagram",
  insta: "instagram",
  facebook: "facebook",
  fb: "facebook",
  google: "google",
  bing: "bing",
  tiktok: "tiktok",
  tt: "tiktok",
  youtube: "youtube",
  yt: "youtube",
  telegram: "telegram",
  tg: "telegram",
  twitter: "x",
  x: "x",
  linkedin: "linkedin",
  kwai: "kwai",
};

/**
 * Domínio do referrer → fonte. Cobre os encurtadores/wrappers de cada rede
 * (`l.instagram.com`, `lm.facebook.com`, `t.co`, `youtu.be`), que é como esses
 * cliques chegam de verdade.
 */
const REFERRER_HOST_SOURCES: [RegExp, ReferralTrafficSource][] = [
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(facebook\.com|fb\.com|messenger\.com)$/, "facebook"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, "whatsapp"],
  [/(^|\.)google\.[a-z.]+$/, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)(t\.me|telegram\.(org|me))$/, "telegram"],
  [/(^|\.)(twitter\.com|x\.com|t\.co)$/, "x"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "linkedin"],
  [/(^|\.)kwai\.com$/, "kwai"],
];

/**
 * Robôs de preview e crawlers, do mais específico para o genérico. A ordem
 * importa: "WhatsApp/2.x" também casaria com um genérico de "bot" se houvesse
 * um antes dele.
 */
const PREVIEW_BOTS: [RegExp, string][] = [
  [/whatsapp\//i, "WhatsApp (preview de link)"],
  [
    /facebookexternalhit|facebookcatalog|meta-externalagent|facebookbot/i,
    "Facebook (preview de link)",
  ],
  [/telegrambot/i, "Telegram (preview de link)"],
  [/twitterbot/i, "X/Twitter (preview de link)"],
  [/linkedinbot/i, "LinkedIn (preview de link)"],
  [/slackbot/i, "Slack (preview de link)"],
  [/discordbot/i, "Discord (preview de link)"],
  [/googlebot|adsbot-google|apis-google|google-inspectiontool/i, "Google (crawler)"],
  [/bingbot|bingpreview/i, "Bing (crawler)"],
  [
    /curl|wget|python-requests|python-urllib|axios\/|node-fetch|go-http-client|okhttp|headlesschrome/i,
    "Ferramentas HTTP",
  ],
  [/(^|[^a-z])(bot|crawler|spider|scraper|preview)([^a-z]|$)/i, "Outros robôs"],
];

/** Parâmetros de campanha que o painel lê da query da `landing_url`. */
const CAMPAIGN_PARAMS = ["src", "utm_source", "utm_medium", "utm_campaign"];

export type ReferralTrafficClick = {
  id: string;
  visitorId: string;
  userAgent: string | null;
  referrerUrl: string | null;
  landingUrl: string | null;
};

export type ReferralClickClassification = {
  kind: "human" | "preview-bot";
  /** Nome do robô quando `kind === "preview-bot"`; senão `null`. */
  botService: string | null;
  source: ReferralTrafficSource;
  /**
   * Rótulo exibido para a fonte. Difere de `REFERRAL_TRAFFIC_SOURCE_LABELS`
   * quando o afiliado declarou um canal próprio no `?src=` — aí o rótulo é o
   * valor declarado.
   */
  sourceLabel: string;
  /** Chave de agrupamento da fonte (inclui canais declarados: `declared:x`). */
  sourceKey: string;
  referrerHost: string | null;
  landingPath: string | null;
  campaignParams: { param: string; value: string }[];
  device: "Desktop" | "Mobile" | "Tablet" | null;
  browser: string | null;
  os: string | null;
};

function parseLanding(landingUrl: string | null): {
  path: string | null;
  params: { param: string; value: string }[];
} {
  if (!landingUrl) return { path: null, params: [] };
  try {
    // `landing_url` é gravada como caminho relativo (`/x?src=y`); a base falsa
    // só existe para o construtor aceitar.
    const url = new URL(landingUrl, "https://relative.invalid");
    const params: { param: string; value: string }[] = [];
    for (const param of CAMPAIGN_PARAMS) {
      const value = url.searchParams.get(param)?.trim().toLowerCase();
      if (value) params.push({ param, value: value.slice(0, 80) });
    }
    return { path: url.pathname || "/", params };
  } catch {
    return { path: null, params: [] };
  }
}

/** Fonte conhecida de um host de referrer, para o painel dar logo ao domínio. */
export function sourceForReferrerHost(
  host: string,
): ReferralTrafficSource | null {
  for (const [pattern, source] of REFERRER_HOST_SOURCES) {
    if (pattern.test(host)) return source;
  }
  return null;
}

function parseReferrerHost(referrerUrl: string | null): string | null {
  if (!referrerUrl) return null;
  try {
    const host = new URL(referrerUrl).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function detectPreviewBot(userAgent: string): string | null {
  for (const [pattern, service] of PREVIEW_BOTS) {
    if (pattern.test(userAgent)) return service;
  }
  return null;
}

function detectInAppSource(userAgent: string): ReferralTrafficSource | null {
  if (/instagram/i.test(userAgent)) return "instagram";
  if (/FBAN|FBAV|FB_IAB|FB4A|FBIOS/i.test(userAgent)) return "facebook";
  if (/bytedance|musical_ly|tiktok/i.test(userAgent)) return "tiktok";
  return null;
}

function detectDevice(userAgent: string): "Desktop" | "Mobile" | "Tablet" {
  if (/ipad|tablet/i.test(userAgent)) return "Tablet";
  if (/android(?!.*mobile)/i.test(userAgent)) return "Tablet";
  if (/mobi|iphone|ipod|android|windows phone/i.test(userAgent)) return "Mobile";
  return "Desktop";
}

function detectBrowser(userAgent: string): string {
  // Navegadores embutidos primeiro: o UA do Instagram também contém "Safari".
  if (/instagram/i.test(userAgent)) return "Instagram (in-app)";
  if (/FBAN|FBAV|FB_IAB|FB4A|FBIOS/i.test(userAgent)) return "Facebook (in-app)";
  if (/bytedance|musical_ly|tiktok/i.test(userAgent)) return "TikTok (in-app)";
  if (/edg(a|ios)?\//i.test(userAgent)) return "Edge";
  if (/opr\/|opera/i.test(userAgent)) return "Opera";
  if (/samsungbrowser/i.test(userAgent)) return "Samsung Internet";
  if (/firefox|fxios/i.test(userAgent)) return "Firefox";
  if (/crios|chrome/i.test(userAgent)) return "Chrome";
  if (/safari/i.test(userAgent)) return "Safari";
  return "Outro";
}

function detectOs(userAgent: string): string {
  // iOS antes de macOS: o UA do iPhone diz "like Mac OS X".
  if (/iphone|ipad|ipod/i.test(userAgent)) return "iOS";
  if (/android/i.test(userAgent)) return "Android";
  if (/windows/i.test(userAgent)) return "Windows";
  if (/macintosh|mac os x/i.test(userAgent)) return "macOS";
  if (/cros/i.test(userAgent)) return "ChromeOS";
  if (/linux/i.test(userAgent)) return "Linux";
  return "Outro";
}

export function classifyReferralClick(
  click: Pick<ReferralTrafficClick, "userAgent" | "referrerUrl" | "landingUrl">,
): ReferralClickClassification {
  const userAgent = click.userAgent ?? "";
  const { path, params } = parseLanding(click.landingUrl);
  const referrerHost = parseReferrerHost(click.referrerUrl);

  const botService = userAgent ? detectPreviewBot(userAgent) : null;
  if (botService) {
    return {
      kind: "preview-bot",
      botService,
      source: "other",
      sourceLabel: botService,
      sourceKey: `bot:${botService}`,
      referrerHost,
      landingPath: path,
      campaignParams: params,
      device: null,
      browser: null,
      os: null,
    };
  }

  let source: ReferralTrafficSource | null = null;
  let sourceLabel: string | null = null;
  let sourceKey: string | null = null;

  // 1. Declarada no link (`src` e, na falta dele, `utm_source`).
  const declared =
    params.find((entry) => entry.param === "src")?.value ??
    params.find((entry) => entry.param === "utm_source")?.value ??
    null;
  if (declared) {
    const alias = DECLARED_SOURCE_ALIASES[declared];
    if (alias) {
      source = alias;
      sourceLabel = REFERRAL_TRAFFIC_SOURCE_LABELS[alias];
      sourceKey = alias;
    } else {
      source = "other";
      sourceLabel = declared;
      sourceKey = `declared:${declared}`;
    }
  }

  // 2. Referrer conhecido.
  if (!source && referrerHost) {
    source = sourceForReferrerHost(referrerHost) ?? "other";
  }

  // 3. App embutido denunciado pelo user-agent (chega sem Referer).
  if ((!source || source === "other") && userAgent) {
    const inApp = detectInAppSource(userAgent);
    if (inApp) source = inApp;
  }

  if (!source) source = "direct";
  if (!sourceLabel) sourceLabel = REFERRAL_TRAFFIC_SOURCE_LABELS[source];
  if (!sourceKey) sourceKey = source;

  return {
    kind: "human",
    botService: null,
    source,
    sourceLabel,
    sourceKey,
    referrerHost,
    landingPath: path,
    campaignParams: params,
    device: userAgent ? detectDevice(userAgent) : "Desktop",
    browser: userAgent ? detectBrowser(userAgent) : "Outro",
    os: userAgent ? detectOs(userAgent) : "Outro",
  };
}

export type ReferralTrafficCount = {
  key: string;
  label: string;
  clicks: number;
  visitors: number;
  signups: number;
};

export type ReferralTrafficReport = {
  totals: {
    /** Cliques humanos — robôs de preview ficam fora e têm painel próprio. */
    clicks: number;
    visitors: number;
    signups: number;
    botClicks: number;
  };
  sources: ReferralTrafficCount[];
  referrers: ReferralTrafficCount[];
  pages: ReferralTrafficCount[];
  campaigns: ReferralTrafficCount[];
  devices: ReferralTrafficCount[];
  browsers: ReferralTrafficCount[];
  operatingSystems: ReferralTrafficCount[];
  bots: ReferralTrafficCount[];
};

/** Quantas linhas cada painel devolve. O resto é cauda longa sem decisão. */
const PANEL_LIMIT = 50;

type Bucket = {
  label: string;
  clicks: number;
  visitors: Set<string>;
  signups: number;
};

function bump(
  map: Map<string, Bucket>,
  key: string,
  label: string,
  visitorId: string,
  signedUp: boolean,
): void {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = { label, clicks: 0, visitors: new Set(), signups: 0 };
    map.set(key, bucket);
  }
  bucket.clicks += 1;
  bucket.visitors.add(visitorId);
  if (signedUp) bucket.signups += 1;
}

function toCounts(map: Map<string, Bucket>): ReferralTrafficCount[] {
  return [...map.entries()]
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      clicks: bucket.clicks,
      visitors: bucket.visitors.size,
      signups: bucket.signups,
    }))
    .sort(
      (a, b) =>
        b.visitors - a.visitors ||
        b.clicks - a.clicks ||
        a.label.localeCompare(b.label),
    )
    .slice(0, PANEL_LIMIT);
}

/**
 * Agrega os Cliques classificados nos painéis do dashboard.
 *
 * `wonClickIds` são os cliques vencedores da atribuição — cada um é um
 * cadastro. O cadastro é creditado ao balde do clique que o produziu, o que dá
 * a cada painel a coluna que decide de verdade: não "de onde vêm cliques", mas
 * "de onde vêm cadastros".
 */
export function buildReferralTrafficReport(
  clicks: readonly ReferralTrafficClick[],
  wonClickIds: ReadonlySet<string>,
): ReferralTrafficReport {
  const sources = new Map<string, Bucket>();
  const referrers = new Map<string, Bucket>();
  const pages = new Map<string, Bucket>();
  const campaigns = new Map<string, Bucket>();
  const devices = new Map<string, Bucket>();
  const browsers = new Map<string, Bucket>();
  const operatingSystems = new Map<string, Bucket>();
  const bots = new Map<string, Bucket>();

  const humanVisitors = new Set<string>();
  let humanClicks = 0;
  let signups = 0;
  let botClicks = 0;

  for (const click of clicks) {
    const c = classifyReferralClick(click);
    const signedUp = wonClickIds.has(click.id);

    if (c.kind === "preview-bot") {
      botClicks += 1;
      bump(bots, c.sourceKey, c.botService ?? "Robô", click.visitorId, false);
      continue;
    }

    humanClicks += 1;
    humanVisitors.add(click.visitorId);
    if (signedUp) signups += 1;

    bump(sources, c.sourceKey, c.sourceLabel, click.visitorId, signedUp);
    if (c.referrerHost) {
      bump(referrers, c.referrerHost, c.referrerHost, click.visitorId, signedUp);
    }
    if (c.landingPath) {
      bump(pages, c.landingPath, c.landingPath, click.visitorId, signedUp);
    }
    for (const { param, value } of c.campaignParams) {
      const key = `${param}=${value}`;
      bump(campaigns, key, key, click.visitorId, signedUp);
    }
    if (c.device) bump(devices, c.device, c.device, click.visitorId, signedUp);
    if (c.browser) {
      bump(browsers, c.browser, c.browser, click.visitorId, signedUp);
    }
    if (c.os) bump(operatingSystems, c.os, c.os, click.visitorId, signedUp);
  }

  return {
    totals: {
      clicks: humanClicks,
      visitors: humanVisitors.size,
      signups,
      botClicks,
    },
    sources: toCounts(sources),
    referrers: toCounts(referrers),
    pages: toCounts(pages),
    campaigns: toCounts(campaigns),
    devices: toCounts(devices),
    browsers: toCounts(browsers),
    operatingSystems: toCounts(operatingSystems),
    bots: toCounts(bots),
  };
}

/** Períodos aceitos pelo filtro. `null` = desde o início. */
export const REFERRAL_TRAFFIC_RANGE_VALUES = [
  "7",
  "30",
  "90",
  "365",
  "all",
] as const;

export type ReferralTrafficRange =
  (typeof REFERRAL_TRAFFIC_RANGE_VALUES)[number];

export const REFERRAL_TRAFFIC_RANGE_LABELS: Record<
  ReferralTrafficRange,
  string
> = {
  "7": "Últimos 7 dias",
  "30": "Últimos 30 dias",
  "90": "Últimos 90 dias",
  "365": "Últimos 12 meses",
  all: "Desde o início",
};

export function parseReferralTrafficRange(
  value: string | null,
): ReferralTrafficRange {
  return (REFERRAL_TRAFFIC_RANGE_VALUES as readonly string[]).includes(
    value ?? "",
  )
    ? (value as ReferralTrafficRange)
    : "30";
}

export function trafficRangeToDays(range: ReferralTrafficRange): number | null {
  return range === "all" ? null : Number(range);
}
