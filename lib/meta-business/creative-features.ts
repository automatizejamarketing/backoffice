/**
 * Advantage+ creative features — adaptação de mídia por posicionamento.
 *
 * O Meta consegue reenquadrar um criativo para os posicionamentos onde ele não
 * cabe (um quadrado 1:1 servido em Stories/Reels 9:16, um vertical servido no
 * Feed). Isso NÃO é automático: é preciso pedir, chave por chave, em
 * `degrees_of_freedom_spec.creative_features_spec` no POST /adcreatives.
 *
 * Sondagem ao vivo contra a v25 (2026-08-18, conta act_509408644106984):
 *
 * - Um criativo criado SEM `degrees_of_freedom_spec` volta do Meta com as 82
 *   chaves materializadas e ZERO em `OPT_IN`. O padrão é tudo desligado — ou
 *   seja, todo anúncio que publicamos hoje sai sem adaptação nenhuma, enquanto o
 *   mesmo anúncio feito no Gerenciador sai com ela ligada.
 * - O bundle `standard_enhancements` foi descontinuado na v22 e é REJEITADO na
 *   criação ("Defina recursos individuais"). Daí a lista por chave abaixo.
 * - `image_crop_style` aceita `{AUTO, CROP, EXPAND, NONE, ZOOM}` — enum que não
 *   está publicado em nenhuma página de documentação, extraído do validador.
 * - Dentro de `customizations`, `aspect_ratio_config.ar_*.adapt` e cada grupo de
 *   `placement_groups` precisam ser OBJETOS (`{ enroll_status }`), não strings.
 *
 * As chaves estão separadas por RISCO DE MARCA, e essa separação é a razão de
 * este módulo existir em vez de um objeto literal solto:
 *
 * - {@link REFRAMING_FEATURES} reenquadram o que o anunciante já enviou (corte,
 *   zoom, escolha de qual mídia usar em qual posicionamento). Ligadas por padrão.
 * - {@link GENERATIVE_FEATURES} EXPANDEM a mídia com conteúdo inventado por IA
 *   fora do quadro original. Numa ferramenta que roda campanha de cliente, isso
 *   é risco de marca — fica atrás de opt-in explícito.
 *
 * Espelhado no backoffice via `bun run sync:meta` como cópia BYTE-IDÊNTICA (vive
 * na raiz de `lib/meta-business/`, caminho que existe igual nos dois projetos, para
 * que `duplicate.ts` — que não passa pela reescrita de imports — também possa
 * importá-lo).
 */

/** Valores aceitos por `customizations.image_crop_style` (extraídos do validador da v25). */
export const IMAGE_CROP_STYLES = ["AUTO", "CROP", "EXPAND", "NONE", "ZOOM"] as const;
export type ImageCropStyle = (typeof IMAGE_CROP_STYLES)[number];

/**
 * Reenquadramento: o Meta corta/dá zoom/escolhe a mídia, mas nunca inventa pixel.
 *
 * - `adapt_to_placement` — ajusta a imagem ao posicionamento (4:5 e 9:16 ligados por padrão)
 * - `pac_relaxation` — mostra a mídia escolhida para um aspect ratio nos demais posicionamentos
 * - `video_auto_crop` — o equivalente para vídeo
 */
export const REFRAMING_FEATURES = [
  "adapt_to_placement",
  "pac_relaxation",
  "video_auto_crop",
] as const;

/**
 * Expansão generativa: a IA cria conteúdo FORA do quadro original.
 *
 * `image_touchups` entra aqui e não em {@link REFRAMING_FEATURES} porque a própria
 * documentação o descreve como "cropped **and expanded** to fit more placements" —
 * ele expande, então carrega o mesmo risco de marca do uncrop.
 */
export const GENERATIVE_FEATURES = [
  "image_uncrop",
  "video_uncrop",
  "image_touchups",
] as const;

export type CreativeFeatureKey =
  | (typeof REFRAMING_FEATURES)[number]
  | (typeof GENERATIVE_FEATURES)[number];

/** Como o anunciante quer que a mídia seja adaptada entre posicionamentos. */
export type PlacementAdaptation = {
  /** Desligar tudo (inclusive o reenquadramento). Padrão: ligado. */
  enabled?: boolean;
  /**
   * Permitir que a IA EXPANDA a mídia para além do quadro original.
   * Padrão: `false` — expansão generativa é decisão do anunciante, não nossa.
   */
  generativeExpansion?: boolean;
  /** Dial de recorte. Padrão `AUTO` (o Meta decide entre cortar, expandir e dar zoom). */
  imageCropStyle?: ImageCropStyle;
};

/** O padrão do produto: reenquadra, nunca inventa. */
export const DEFAULT_PLACEMENT_ADAPTATION: Required<PlacementAdaptation> = {
  enabled: true,
  generativeExpansion: false,
  imageCropStyle: "AUTO",
};

type EnrollStatus = { enroll_status: "OPT_IN" | "OPT_OUT" };
type FeatureDetails = EnrollStatus & { customizations?: Record<string, unknown> };

function resolve(adaptation?: PlacementAdaptation): Required<PlacementAdaptation> {
  return { ...DEFAULT_PLACEMENT_ADAPTATION, ...(adaptation ?? {}) };
}

/**
 * As chaves que queremos ligadas, já com as `customizations` de cada uma.
 *
 * Só emite chaves em `OPT_IN`: nunca escrevemos `OPT_OUT` explícito, porque o
 * Meta já materializa todas as 82 como `OPT_OUT` por conta própria e listar as
 * outras 79 só engordaria o payload sem mudar nada.
 *
 * Retorna `null` quando não há nada a pedir (adaptação desligada) — assim o
 * chamador simplesmente não manda o campo, em vez de mandar um objeto vazio.
 */
export function buildCreativeFeaturesSpec(
  adaptation?: PlacementAdaptation,
): Record<string, FeatureDetails> | null {
  const { enabled, generativeExpansion, imageCropStyle } = resolve(adaptation);
  if (!enabled) return null;

  const spec: Record<string, FeatureDetails> = {};
  for (const key of REFRAMING_FEATURES) {
    spec[key] = { enroll_status: "OPT_IN" };
  }
  // O dial de recorte só existe em adapt_to_placement.
  spec.adapt_to_placement = {
    enroll_status: "OPT_IN",
    customizations: { image_crop_style: imageCropStyle },
  };

  if (generativeExpansion) {
    for (const key of GENERATIVE_FEATURES) {
      spec[key] = { enroll_status: "OPT_IN" };
    }
  }
  return spec;
}

/** O objeto completo do campo `degrees_of_freedom_spec`, ou null se não há o que pedir. */
export function buildDegreesOfFreedomSpec(
  adaptation?: PlacementAdaptation,
): { creative_features_spec: Record<string, FeatureDetails> } | null {
  const spec = buildCreativeFeaturesSpec(adaptation);
  return spec ? { creative_features_spec: spec } : null;
}

/**
 * Sobrepõe nossas chaves a um `creative_features_spec` que JÁ existe no criativo
 * (o caminho de duplicação: o anúncio comprovado traz o spec dele, e queremos
 * ligar a adaptação sem apagar o que o anunciante já tinha configurado).
 *
 * `standard_enhancements` é removido de quebra: ele é rejeitado na criação desde
 * a v22, e um criativo antigo que ainda o carrega faria a cópia falhar.
 */
export function withPlacementAdaptation(
  existing: Record<string, unknown> | undefined,
  adaptation?: PlacementAdaptation,
): Record<string, unknown> | null {
  const ours = buildCreativeFeaturesSpec(adaptation);
  if (!ours) return null;
  const merged: Record<string, unknown> = { ...(existing ?? {}) };
  delete merged.standard_enhancements;
  return Object.assign(merged, ours);
}
