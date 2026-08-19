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
 * Altura MÍNIMA do quadro por posicionamento, em pixels — medida no conteúdo real
 * que o Meta renderiza, não no que ele declara.
 *
 * O `<iframe>` que o `generatepreviews` devolve traz `width`/`height`, e para
 * Stories e Feed eles servem. Para REELS eles MENTEM: o Meta declara 274x213 e
 * renderiza 624px de altura no Instagram e 567 no Facebook — 400px a mais. Uma
 * caixa do tamanho declarado corta quase tudo, que foi o que apareceu na tela
 * como uma faixa preta com um pedaço da imagem.
 *
 * Medido em 2026-08-19 injetando cada prévia num iframe de 800x1400 e lendo a
 * altura do `body`. O conteúdo é RESPONSIVO em largura (preenche o que receber) e
 * tem altura fixa por formato — por isso a largura é uma escolha nossa e a altura,
 * não.
 *
 * Usado como PISO, nunca como valor absoluto: a caixa vale
 * `max(altura declarada, este piso)`, então se o Meta um dia declarar mais, a UI
 * acompanha; se declarar de menos, o piso protege.
 */
export const MIN_PREVIEW_FRAME_HEIGHT: Record<PlacementKey, number> = {
  instagram_stories: 567,
  facebook_stories: 567,
  instagram_reels: 624,
  facebook_reels: 567,
  instagram_feed: 525,
  facebook_feed: 450,
};

/**
 * Largura do quadro. É escolha nossa porque o conteúdo se adapta à largura que
 * receber; 335 é a maior que o Meta declara e cabe na coluna de 380px do painel.
 */
export const PREVIEW_FRAME_WIDTH = 335;

/** Altura de reserva enquanto a prévia não chegou (skeleton, erro, espera). */
export const PREVIEW_FRAME_HEIGHT: Record<"1:1" | "4:5" | "9:16", number> = {
  "9:16": 567,
  "4:5": 525,
  "1:1": 450,
};

/** Proporção nominal de cada posicionamento — escolhe a altura de reserva acima. */
export const PLACEMENT_ASPECT_RATIO: Record<PlacementKey, "1:1" | "4:5" | "9:16"> = {
  facebook_feed: "4:5",
  facebook_stories: "9:16",
  facebook_reels: "9:16",
  instagram_feed: "4:5",
  instagram_stories: "9:16",
  instagram_reels: "9:16",
};
