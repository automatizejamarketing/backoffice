/**
 * O que é um snapshot de criativo (§4.6 e §5/4 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Costura pura: decide QUEM buscar e transforma a resposta da Meta em linha de
 * `meta_tracking_creatives`. Sem I/O — quem fala com a Graph API é
 * `graph-collector-gateway.ts`, quem fala com o Postgres é
 * `lib/db/meta-tracking-creative-queries.ts` e quem coordena é
 * `collect-creative-snapshots.ts`.
 */

import {
  chunkIds,
  DEEP_FETCH_CHUNK_SIZE,
} from "@/lib/meta-tracking/daily-collection-plan";

/**
 * Teto de criativos por conta e por execução.
 *
 * O passivo de uma conta recém-ativada pode ser de milhares de criativos, e
 * gastá-los todos numa invocação roubaria a cota das etapas que têm prazo (a
 * configuração do dia não existe em lugar nenhum para ser buscada depois; o
 * criativo, sim — ele é imutável e continua lá amanhã). O que passar do teto
 * volta na execução seguinte, porque a varredura é auto-corretiva.
 */
export const MAX_CREATIVES_PER_ACCOUNT_RUN = 300;

export type CreativeFetchPlan = {
  /** Lotes de ids para o node batch (`?ids=a,b,c`). */
  chunks: string[][];
  /** Desconhecidos que não couberam nesta execução e voltam na próxima. */
  deferred: number;
};

/**
 * Quais criativos desconhecidos buscar agora.
 *
 * Deduplica de propósito: o mesmo criativo é referenciado por vários anúncios
 * (duplicar anúncio é a operação mais comum do Gerenciador), e pedi-lo duas
 * vezes no mesmo node batch é chamada jogada fora.
 */
export function planCreativeFetch(input: {
  unknownIds: readonly string[];
}): CreativeFetchPlan {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of input.unknownIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }

  const selected = unique.slice(0, MAX_CREATIVES_PER_ACCOUNT_RUN);

  return {
    chunks: chunkIds(selected, DEEP_FETCH_CHUNK_SIZE),
    deferred: unique.length - selected.length,
  };
}

/** O nó de criativo como a Graph API o devolve. */
export type RawCreative = Record<string, unknown>;

/** Uma linha de `meta_tracking_creatives` pronta para inserir. */
export type CreativeSnapshotRow = {
  /** O id da própria Meta — a tabela é chaveada por ele. */
  id: string;
  accountId: string;
  /** A resposta ÍNTEGRA, para o jsonb. */
  spec: RawCreative;
};

/**
 * A resposta da Meta vira linha.
 *
 * O nó vai íntegro para o `spec`, sem seleção de campos: criativo é imutável e
 * esta é a única foto que existirá dele: um campo descartado hoje porque
 * ninguém consulta não teria como ser recuperado quando alguém consultar.
 *
 * Sem `id` não há linha — o node batch devolve `false` ou objeto vazio para id
 * que não existe mais, e gravar isso criaria um snapshot que nunca casa com
 * anúncio nenhum.
 */
export function toCreativeSnapshotRow(input: {
  accountId: string;
  node: unknown;
}): CreativeSnapshotRow | null {
  const node = input.node;
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;

  const id = (node as { id?: unknown }).id;
  if (typeof id !== "string" || id.length === 0) return null;

  return { id, accountId: input.accountId, spec: node as RawCreative };
}

/**
 * As formas de `object_story_spec` — uma por tipo de anúncio. A Meta usa a
 * chave para dizer o que o anúncio é, e a URL de destino muda de lugar junto.
 */
const STORY_DATA_KEYS = [
  "link_data",
  "video_data",
  "photo_data",
  "template_data",
] as const;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `{ call_to_action: { value: { link } } }` — o destino do botão. */
function callToActionLink(container: Record<string, unknown>): unknown {
  return asObject(asObject(container.call_to_action)?.value)?.link;
}

/**
 * Para onde este criativo levava — a URL de promoção do §24 da spec.
 *
 * Existe porque a resposta da Meta NÃO tem um campo de destino: a URL muda de
 * lugar conforme o tipo do anúncio (`link_data.link` no anúncio de link, só
 * dentro do `call_to_action` no de vídeo, uma lista em `asset_feed_spec` no
 * Advantage+, uma por cartão no carrossel). Concentrar as variantes aqui é o
 * que evita que cada consumidor futuro reinvente — e erre — a travessia. No
 * banco a mesma pergunta se responde por jsonb
 * (`spec -> 'object_story_spec' -> 'link_data' ->> 'link'`).
 *
 * Lista, e não valor único, porque carrossel e Advantage+ promovem vários
 * destinos de verdade. Vazia quando a Meta não declara nenhum — post
 * impulsionado é o caso comum, e chutar seria pior do que responder "não há".
 */
export function promotionUrlsOf(spec: unknown): string[] {
  const creative = asObject(spec);
  if (!creative) return [];

  const found: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== "string" || value.length === 0) return;
    if (found.includes(value)) return;
    found.push(value);
  };

  const story = asObject(creative.object_story_spec);
  for (const key of STORY_DATA_KEYS) {
    const data = story && asObject(story[key]);
    if (!data) continue;
    push(data.link);
    push(callToActionLink(data));
    for (const attachment of asArray(data.child_attachments)) {
      const card = asObject(attachment);
      if (!card) continue;
      push(card.link);
      push(callToActionLink(card));
    }
  }

  const assetFeed = asObject(creative.asset_feed_spec);
  if (assetFeed) {
    for (const entry of asArray(assetFeed.link_urls)) {
      const url = asObject(entry);
      if (url) push(url.website_url);
    }
    for (const entry of asArray(assetFeed.call_to_actions)) {
      const cta = asObject(entry);
      if (cta) push(asObject(cta.value)?.link);
    }
  }

  return found;
}
