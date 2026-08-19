/**
 * Tamanho do quadro da prévia — e a ÚNICA fonte da verdade para ele.
 *
 * `generatepreviews` aceita `width`/`height` e renderiza o anúncio para caber
 * neles. Se a UI desenhar uma caixa menor do que a que foi pedida ao Meta, a
 * prévia é CORTADA — foi o que aconteceu com Stories, cuja parte de baixo (o CTA
 * e a barra do app) sumia. Por isso os números vivem juntos e são usados nos dois
 * lados: quem pede ao Meta e quem desenha o iframe.
 *
 * Por que num arquivo só deles, e não em `placement-previews.ts`: aquele módulo
 * importa `metaApiCall`, que puxa o logger e daí `node:async_hooks`. O painel de
 * prévias é um componente de CLIENTE — importar as medidas de lá arrastava a
 * cadeia server-only para o bundle do browser e quebrava a compilação com
 * "Code generation for chunk item errored" em `meta-log-context.ts`. Aqui só
 * existe uma importação de TIPO, que é apagada na compilação, então este módulo
 * pode ser importado dos dois lados sem arrastar nada.
 *
 * Os dois caminhos de import aqui e no irmão `placement-previews.ts` NÃO são
 * estilo solto: `@/lib/meta-business/placements` é absoluto porque a
 * reescrita do espelho o achata para a raiz, que é onde `placements` mora no
 * backoffice; já a referência ENTRE estes dois arquivos é relativa justamente
 * porque a reescrita não toca em caminho relativo — e os dois continuam lado a
 * lado em `marketing/` nos dois projetos.
 */

import type { PlacementKey } from "@/lib/meta-business/placements";

/**
 * Medidas de RESERVA — usadas só enquanto a prévia não chegou (skeleton, erro,
 * espera do upload de vídeo). Quando ela chega, a caixa passa a valer o tamanho
 * que o próprio Meta declarou no iframe.
 *
 * Os números são os que o Meta devolve hoje, medidos ao vivo em 2026-08-19, para
 * a reserva ter o tamanho certo e o layout não pular quando a prévia entra:
 * Stories 320x567, Feed do Instagram 320x525, Feed do Facebook 335x450,
 * Reels 274x213. Aqui ficam agrupados pela proporção, que é o que dá para saber
 * antes da resposta.
 */
export const PREVIEW_FRAME_WIDTH = 335;

export const PREVIEW_FRAME_HEIGHT: Record<"1:1" | "4:5" | "9:16", number> = {
  "9:16": 567,
  "4:5": 525,
  "1:1": 450,
};

/** Proporção nominal de cada posicionamento — escolhe a altura do quadro acima. */
export const PLACEMENT_ASPECT_RATIO: Record<PlacementKey, "1:1" | "4:5" | "9:16"> = {
  facebook_feed: "4:5",
  facebook_stories: "9:16",
  facebook_reels: "9:16",
  instagram_feed: "4:5",
  instagram_stories: "9:16",
  instagram_reels: "9:16",
};
