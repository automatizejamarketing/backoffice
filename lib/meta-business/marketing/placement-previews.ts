/**
 * Previews do criativo em cada posicionamento, via `GET /act_{id}/generatepreviews`.
 *
 * O endpoint devolve um `<iframe>` pronto por `ad_format`. Nada é criado na conta:
 * é um GET que aceita a especificação do criativo inline, então dá para mostrar o
 * anúncio ao usuário ANTES de publicar.
 *
 * LIMITE IMPORTANTE, comprovado em anúncio real (2026-08-18):
 * o preview NÃO reflete `adapt_to_placement`. Dois anúncios idênticos exceto pela
 * feature renderizam pixel a pixel igual. O que o preview mostra é o criativo
 * dentro do FRAME de cada posicionamento — útil para o usuário ver que a arte
 * quadrada dele vai aparecer em Stories, e como o texto/CTA se acomodam ali —
 * mas não é uma pré-visualização do reenquadramento. A UI não pode prometer isso.
 */

import { metaApiCall } from "@/lib/meta-business/api";
import { ALL_PLACEMENTS, type PlacementKey } from "@/lib/meta-business/placements";
import {
  PLACEMENT_ASPECT_RATIO,
  PREVIEW_FRAME_HEIGHT,
  PREVIEW_FRAME_WIDTH,
} from "./placement-preview-frame";

// Reexportados para quem já os consumia daqui; a definição vive no módulo acima,
// que não importa nada de runtime e por isso pode ser lido pelo cliente também.
export { PLACEMENT_ASPECT_RATIO, PREVIEW_FRAME_HEIGHT, PREVIEW_FRAME_WIDTH };

/**
 * `ad_format` de `generatepreviews` para cada posicionamento que o produto expõe.
 * Fica AQUI, e não em `creative-features.ts`, porque aquele módulo é espelhado
 * byte a byte (imports não são reescritos) e `placements` vive em caminhos
 * diferentes nos dois projetos. Este arquivo é espelho normalizado, então o
 * import é reescrito e resolve dos dois lados.
 *
 * Irmão de `PLACEMENT_TO_META` (placements.ts), que faz a tradução para targeting.
 */
export const PLACEMENT_PREVIEW_FORMAT: Record<PlacementKey, string> = {
  facebook_feed: "MOBILE_FEED_STANDARD",
  facebook_stories: "FACEBOOK_STORY_MOBILE",
  facebook_reels: "FACEBOOK_REELS_MOBILE",
  instagram_feed: "INSTAGRAM_STANDARD",
  instagram_stories: "INSTAGRAM_STORY",
  instagram_reels: "INSTAGRAM_REELS",
};


/** Destino usado quando o anúncio ainda não tem um link utilizável. */
export const DEFAULT_PREVIEW_LINK = "https://automatizemarketing.com";

/**
 * Hostname público plausível: rótulos alfanuméricos separados por ponto.
 *
 * Checar só o protocolo NÃO basta, e essa foi a causa de um bug real:
 * `new URL("https:;;")` não lança — o parser aceita e devolve `https://;;/` com
 * host `;;`. Exigir ao menos um ponto também descarta `http:abc`, que vira
 * `http://abc/`.
 */
const PUBLIC_HOSTNAME =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * O link que pode ir ao Meta, ou o destino padrão quando o informado não serve.
 *
 * A tela de revisão guarda o campo de destino a cada tecla e o painel refaz as
 * prévias quando a edição para — então um link pela metade chega aqui com
 * frequência. Sem esta guarda ele vira erro do Meta (subcode 2490193, "Link
 * inválido de URL fornecido") e os seis posicionamentos falham de uma vez.
 * Pré-visualizar com o destino padrão é melhor do que não pré-visualizar.
 */
export function usableLink(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_PREVIEW_LINK;
  try {
    const url = new URL(trimmed);
    const usable =
      (url.protocol === "http:" || url.protocol === "https:") &&
      PUBLIC_HOSTNAME.test(url.hostname);
    return usable ? trimmed : DEFAULT_PREVIEW_LINK;
  } catch {
    return DEFAULT_PREVIEW_LINK;
  }
}

export type PlacementPreview = {
  placement: PlacementKey;
  aspectRatio: "1:1" | "4:5" | "9:16";
  /** URL do iframe que o Meta devolve, ou null quando aquele posicionamento falhou. */
  iframeUrl: string | null;
  /** Motivo legível quando `iframeUrl` é null — a UI mostra no lugar do preview. */
  error?: string;
  /**
   * Tamanho que o Meta declarou para ESTE formato. A UI desenha a caixa com
   * exatamente estas medidas; qualquer outra coisa deixa borda branca sobrando
   * (caixa maior) ou corta o conteúdo (caixa menor).
   */
  width?: number;
  height?: number;
};

/** Extrai o `src` do `<iframe …>` que o Meta devolve em `data[0].body`. */
export function extractIframeUrl(body: unknown): string | null {
  if (typeof body !== "string") return null;
  const match = body.match(/src="([^"]+)"/);
  return match ? match[1].replace(/&amp;/g, "&") : null;
}

/**
 * As dimensões que o Meta declara no próprio `<iframe>`.
 *
 * Cada `ad_format` tem um tamanho natural PRÓPRIO — Stories 320x567, Feed do
 * Facebook 335x450, Reels 274x213 — e eles não derivam da proporção da mídia.
 * Impor um tamanho nosso (era 340x680 para tudo que fosse 9:16) fazia o conteúdo
 * render menor que a caixa e sobrar a moldura branca do iframe em volta.
 *
 * Por isso NÃO pedimos mais `width`/`height`: deixamos o Meta responder no
 * tamanho dele e desenhamos a caixa exatamente nesse tamanho. Se ele mudar as
 * medidas um dia, a UI acompanha sozinha.
 */
export function extractIframeSize(
  body: unknown,
): { width: number; height: number } | null {
  if (typeof body !== "string") return null;
  const w = body.match(/width="(\d+)"/);
  const h = body.match(/height="(\d+)"/);
  if (!w || !h) return null;
  return { width: Number(w[1]), height: Number(h[1]) };
}

type GeneratePreviewsResponse = { data?: Array<{ body?: string }> };

/**
 * Um preview por posicionamento pedido.
 *
 * Cada `ad_format` é uma chamada separada — o endpoint não aceita lote. São 6
 * chamadas em paralelo; um posicionamento que falhe vira `iframeUrl: null` com o
 * motivo, em vez de derrubar os outros cinco. Isso importa porque alguns
 * criativos são inelegíveis para posicionamentos específicos (um vídeo com música
 * licenciada em Reels, por exemplo) e a resposta parcial ainda é útil.
 */
export async function generatePlacementPreviews(args: {
  adAccountId: string;
  accessToken: string;
  /** Especificação do criativo (object_story_spec + degrees_of_freedom_spec). */
  creative: Record<string, unknown>;
  placements?: readonly PlacementKey[];
}): Promise<PlacementPreview[]> {
  const { adAccountId, accessToken, creative } = args;
  const placements = args.placements?.length ? args.placements : ALL_PLACEMENTS;
  const account = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const creativeParam = JSON.stringify(creative);

  return Promise.all(
    placements.map(async (placement): Promise<PlacementPreview> => {
      const base = {
        placement,
        aspectRatio: PLACEMENT_ASPECT_RATIO[placement],
      } as const;
      try {
        const res = await metaApiCall<GeneratePreviewsResponse>({
          method: "GET",
          path: `${account}/generatepreviews`,
          params: new URLSearchParams({
            ad_format: PLACEMENT_PREVIEW_FORMAT[placement],
            creative: creativeParam,
          }).toString(),
          accessToken,
        });
        const body = res.data?.[0]?.body;
        const iframeUrl = extractIframeUrl(body);
        const size = extractIframeSize(body);
        return iframeUrl
          ? { ...base, iframeUrl, ...(size ?? {}) }
          : { ...base, iframeUrl: null, error: "O Meta não retornou preview para este posicionamento." };
      } catch (error) {
        return {
          ...base,
          iframeUrl: null,
          error:
            error instanceof Error
              ? error.message
              : "Não foi possível gerar o preview.",
        };
      }
    }),
  );
}
