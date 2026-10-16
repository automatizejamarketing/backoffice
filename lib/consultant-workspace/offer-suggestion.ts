/**
 * "Sugerir oferta/combo" para o criativo ruim — a parte pura: o que vai no
 * prompt (empresa, anúncios ruins e os melhores como contraste, cardápio se
 * houver) e como a resposta do modelo vira 3 opções seguras.
 *
 * A chamada ao modelo e as leituras do banco ficam em
 * `offer-suggestion-data.ts`; aqui nada toca rede, então dá para testar.
 */
import * as z from "zod/v4";
import { formatMoney } from "./metrics";
import { clip, evaluateCreative, type AdPerformance } from "./playbook-actions";
import type { WorkspaceGoal } from "./types";

// ---------------------------------------------------------------- copy do criativo

export type CreativeCopy = { titles: string[]; bodies: string[]; descriptions: string[]; cta: string | null };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asText = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

const textsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => asText(asRecord(item)?.text) ?? asText(item)).filter((item): item is string => !!item) : [];

/**
 * Título, texto e CTA do criativo como a Meta guardou em
 * `meta_tracking_creatives.spec`: campos do topo, `object_story_spec`
 * (link/vídeo/template, carrossel) e as variações do `asset_feed_spec`.
 */
export function extractCreativeCopy(spec: unknown): CreativeCopy {
  const record = asRecord(spec);
  const empty: CreativeCopy = { titles: [], bodies: [], descriptions: [], cta: null };
  if (!record) return empty;
  const story = asRecord(record.object_story_spec);
  const link = asRecord(story?.link_data);
  const video = asRecord(story?.video_data);
  const template = asRecord(story?.template_data);
  const asset = asRecord(record.asset_feed_spec);
  const children = Array.isArray(link?.child_attachments) ? link.child_attachments.map(asRecord) : [];

  const titles = [asText(record.title), asText(link?.name), asText(video?.title), asText(template?.name), ...textsOf(asset?.titles), ...children.map((child) => asText(child?.name))];
  const bodies = [asText(record.body), asText(link?.message), asText(video?.message), asText(template?.message), ...textsOf(asset?.bodies)];
  const descriptions = [asText(link?.description), asText(video?.link_description), ...textsOf(asset?.descriptions), ...children.map((child) => asText(child?.description))];
  const ctaTypes = Array.isArray(asset?.call_to_action_types) ? asset.call_to_action_types : [];
  const cta =
    asText(asRecord(link?.call_to_action)?.type) ??
    asText(asRecord(video?.call_to_action)?.type) ??
    asText(record.call_to_action_type) ??
    asText(ctaTypes[0]);

  const unique = (values: Array<string | null>, max: number) =>
    [...new Set(values.filter((value): value is string => !!value).map((value) => clip(value, 300)))].slice(0, max);
  return { titles: unique(titles, 3), bodies: unique(bodies, 3), descriptions: unique(descriptions, 2), cta };
}

// ---------------------------------------------------------------- entrada do prompt

export type OfferAdInput = {
  adId: string;
  name: string;
  campaignName: string | null;
  format: "vídeo" | "imagem";
  spend: number;
  spendShare: number;
  results: number;
  resultLabel: string;
  costLabel: string;
  cost: number | null;
  copy: CreativeCopy;
};

export type OfferMenuItem = { name: string; category: string | null; description: string | null; priceCentavos: number; featured: boolean };

export type OfferCompany = {
  name: string | null;
  description: string | null;
  niche: string | null;
  subNiche: string | null;
  industry: string | null;
  targetAudience: string | null;
  city: string | null;
};

export type OfferPromptInput = {
  days: number;
  company: OfferCompany;
  badAds: OfferAdInput[];
  bestAds: OfferAdInput[];
  menu: { items: OfferMenuItem[]; hasPrices: boolean };
};

export const OFFER_MAX_BAD_ADS = 3;
export const OFFER_MAX_BEST_ADS = 3;
export const OFFER_MAX_MENU_ITEMS = 40;

export type OfferAdSource = AdPerformance & { isVideo: boolean };

/**
 * Anúncios que entram no prompt: os pedidos (`adIds`) ou, sem pedido, os que
 * as regras de criativo ruim apontam; como contraste, os de menor custo por
 * resultado no período.
 */
export function selectOfferAds(args: {
  ads: OfferAdSource[];
  adIds?: string[];
  goal: WorkspaceGoal | undefined;
  days: number;
}): { bad: OfferAdSource[]; best: OfferAdSource[] } {
  const byId = new Map(args.ads.map((ad) => [ad.adId, ad]));
  let bad: OfferAdSource[] = (args.adIds ?? []).map((id) => byId.get(id)).filter((ad): ad is OfferAdSource => !!ad);
  if (bad.length === 0) {
    bad = args.ads.filter((ad) => evaluateCreative({ ad, ads: args.ads, goal: args.goal, diagnoses: [], days: args.days }));
  }
  bad = bad.slice(0, OFFER_MAX_BAD_ADS);
  const badIds = new Set(bad.map((ad) => ad.adId));
  const kind = bad[0]?.kpi.kind;
  const best = args.ads
    .filter((ad) => !badIds.has(ad.adId) && ad.current.spend > 0 && ad.kpi.count > 0 && ad.kpi.cost != null)
    .sort((a, b) => Number(b.kpi.kind === kind) - Number(a.kpi.kind === kind) || (a.kpi.cost ?? 0) - (b.kpi.cost ?? 0))
    .slice(0, OFFER_MAX_BEST_ADS);
  return { bad, best };
}

export function toOfferAdInput(ad: OfferAdSource, copy: CreativeCopy): OfferAdInput {
  return {
    adId: ad.adId,
    name: clip(ad.name, 120),
    campaignName: ad.campaignName ? clip(ad.campaignName, 120) : null,
    format: ad.isVideo ? "vídeo" : "imagem",
    spend: Math.round(ad.current.spend * 100) / 100,
    spendShare: Math.round(ad.spendShare * 100) / 100,
    results: ad.kpi.count,
    resultLabel: ad.kpi.label.toLowerCase(),
    costLabel: ad.kpi.costLabel,
    cost: ad.kpi.cost == null ? null : Math.round(ad.kpi.cost * 100) / 100,
    copy,
  };
}

/** Monta a entrada do prompt; o cardápio entra só com itens ativos, os destaques primeiro. */
export function buildOfferPromptInput(raw: {
  days: number;
  company: OfferCompany | null;
  bad: OfferAdSource[];
  best: OfferAdSource[];
  copyByAd: ReadonlyMap<string, CreativeCopy>;
  menuItems: OfferMenuItem[];
}): OfferPromptInput {
  const noCopy: CreativeCopy = { titles: [], bodies: [], descriptions: [], cta: null };
  const items = [...raw.menuItems]
    .sort((a, b) => Number(b.featured) - Number(a.featured))
    .slice(0, OFFER_MAX_MENU_ITEMS)
    .map((item) => ({
      ...item,
      name: clip(item.name, 80),
      description: item.description ? clip(item.description, 140) : null,
    }));
  return {
    days: raw.days,
    company: raw.company ?? { name: null, description: null, niche: null, subNiche: null, industry: null, targetAudience: null, city: null },
    badAds: raw.bad.map((ad) => toOfferAdInput(ad, raw.copyByAd.get(ad.adId) ?? noCopy)),
    bestAds: raw.best.map((ad) => toOfferAdInput(ad, raw.copyByAd.get(ad.adId) ?? noCopy)),
    menu: { items, hasPrices: items.some((item) => item.priceCentavos > 0) },
  };
}

// ---------------------------------------------------------------- prompt

const adLine = (ad: OfferAdInput) => {
  const copy = [
    ad.copy.titles.length ? `títulos: ${ad.copy.titles.map((t) => `"${t}"`).join(" / ")}` : null,
    ad.copy.bodies.length ? `textos: ${ad.copy.bodies.map((t) => `"${t}"`).join(" / ")}` : null,
    ad.copy.cta ? `botão: ${ad.copy.cta}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  return `- "${ad.name}" (${ad.format}${ad.campaignName ? `, campanha "${ad.campaignName}"` : ""}): gasto ${formatMoney(ad.spend)} (${Math.round(ad.spendShare * 100)}% da verba), ${ad.results} ${ad.resultLabel}, ${ad.costLabel} ${formatMoney(ad.cost)}${copy ? `. ${copy}` : ". (sem texto do criativo salvo)"}`;
};

export const OFFER_SYSTEM_PROMPT = [
  "Você é estrategista de ofertas de uma agência de tráfego pago que atende restaurantes, deliveries e pequenos negócios no Brasil.",
  "Sua tarefa: propor 3 ofertas ou combos para substituir a mensagem de um anúncio que está gastando sem trazer resultado.",
  "Pense primeiro nos dados (o que o anúncio ruim promete, o que os bons têm de diferente, o que o negócio vende), depois responda.",
  "Regras:",
  "1. Só proponha o que o negócio plausivelmente vende. Com cardápio, monte as ofertas com os itens dele, pelo nome.",
  "2. Preço: NUNCA invente preço exato. Só cite valores em R$ se vierem do cardápio fornecido (ex.: soma dos itens e um desconto sobre ela). Sem cardápio, dê uma dica relativa (ex.: \"combo ~15% abaixo dos itens separados\", \"preço de entrada para atrair primeiro pedido\").",
  "3. As 3 opções devem ser diferentes entre si (ex.: combo, condição/brinde, oferta por dia/horário).",
  "4. Português do Brasil, direto, sem jargão. creativeLine é a frase de chamada do anúncio, até 120 caracteres.",
  "Responda SOMENTE com um JSON válido, sem texto antes ou depois, no formato:",
  '{"suggestions":[{"name":"nome curto da oferta","composition":"o que vem na oferta","priceHint":"dica de preço","whyItWorks":"por que deve funcionar melhor que o anúncio atual","creativeLine":"frase do anúncio"}]}',
].join("\n");

export function buildOfferPrompt(input: OfferPromptInput): { system: string; prompt: string } {
  const company = input.company;
  const lines = [
    `Negócio: ${company.name ?? "(sem nome)"}${company.city ? ` — ${company.city}` : ""}.`,
    company.niche || company.subNiche || company.industry
      ? `Segmento: ${[company.niche, company.subNiche, company.industry].filter(Boolean).join(" / ")}.`
      : null,
    company.description ? `Descrição: ${clip(company.description, 500)}` : null,
    company.targetAudience ? `Público: ${clip(company.targetAudience, 300)}` : null,
    "",
    `Anúncios fracos (últimos ${input.days} dias):`,
    ...(input.badAds.length ? input.badAds.map(adLine) : ["- (nenhum anúncio identificado; proponha ofertas a partir do negócio)"]),
    "",
    "Anúncios que funcionam melhor no mesmo período (contraste):",
    ...(input.bestAds.length ? input.bestAds.map(adLine) : ["- (nenhum com resultado no período)"]),
    "",
    input.menu.items.length
      ? `Cardápio (${input.menu.items.length} itens${input.menu.hasPrices ? ", com preço" : ""}):`
      : "Cardápio: não cadastrado — não cite preços exatos.",
    ...input.menu.items.map(
      (item) =>
        `- ${item.name}${item.category ? ` [${item.category}]` : ""}${item.priceCentavos > 0 ? ` — ${formatMoney(item.priceCentavos / 100)}` : ""}${item.featured ? " (destaque)" : ""}${item.description ? `: ${item.description}` : ""}`,
    ),
  ].filter((line): line is string => line !== null);
  return { system: OFFER_SYSTEM_PROMPT, prompt: lines.join("\n") };
}

// ---------------------------------------------------------------- resposta

export type OfferSuggestion = {
  name: string;
  composition: string;
  priceHint: string;
  whyItWorks: string;
  creativeLine: string;
};

/** Resposta da rota e do MCP: as opções e no que a IA se baseou. */
export type OfferSuggestionResult = {
  suggestions: OfferSuggestion[];
  model: string;
  basedOn: {
    badAds: Array<{ adId: string; name: string }>;
    bestAds: Array<{ adId: string; name: string }>;
    menuItems: number;
    menuHasPrices: boolean;
  };
};

const rawSuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        name: z.string(),
        composition: z.string(),
        priceHint: z.string().optional().default(""),
        whyItWorks: z.string(),
        creativeLine: z.string().optional().default(""),
      }),
    )
    .min(1),
});

const PRICE_PATTERN = /R\$\s*\d/;
const PRICE_VALUES = /R\$\s*\d+(?:[.,]\d+)*/g;
const NO_PRICE_HINT = "Defina o preço com o cliente (sem cardápio com preços cadastrado).";
/** Sem cardápio com preço, valor em R$ no texto é invenção: vira "preço especial". */
const withoutPrices = (text: string, hasPrices: boolean) => (hasPrices ? text : text.replace(PRICE_VALUES, "preço especial"));

/**
 * Lê o JSON do modelo (com ou sem cercas de código), corta nos limites e
 * apaga preço exato quando o cardápio não trouxe preço — a regra que o
 * prompt pede, garantida aqui.
 */
export function parseOfferResponse(text: string, hasPrices: boolean): OfferSuggestion[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("A IA não devolveu as sugestões no formato esperado.");
  let json: unknown;
  try {
    json = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new Error("A IA não devolveu as sugestões no formato esperado.");
  }
  const parsed = rawSuggestionSchema.safeParse(json);
  if (!parsed.success) throw new Error("A IA não devolveu as sugestões no formato esperado.");
  return parsed.data.suggestions.slice(0, 3).map((item) => {
    const priceHint = item.priceHint.trim();
    return {
      name: clip(withoutPrices(item.name, hasPrices), 80),
      composition: clip(withoutPrices(item.composition, hasPrices), 240),
      priceHint: !hasPrices && PRICE_PATTERN.test(priceHint) ? NO_PRICE_HINT : clip(priceHint, 140),
      whyItWorks: clip(withoutPrices(item.whyItWorks, hasPrices), 280),
      creativeLine: clip(withoutPrices(item.creativeLine, hasPrices), 120),
    };
  });
}
