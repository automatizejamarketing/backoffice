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
 *   chaves materializadas e ZERO em `OPT_IN`. O padrão é tudo desligado.
 * - O bundle `standard_enhancements` foi descontinuado na v22 e é REJEITADO na
 *   criação ("Defina recursos individuais"). Daí a lista por chave abaixo.
 * - `image_crop_style` aceita `{AUTO, CROP, EXPAND, NONE, ZOOM}` — enum que não
 *   está publicado em nenhuma página de documentação, extraído do validador.
 * - Dentro de `customizations`, `aspect_ratio_config.ar_*.adapt` e cada grupo de
 *   `placement_groups` precisam ser OBJETOS (`{ enroll_status }`), não strings.
 *
 * REGRA DO PRODUTO (30/09/2026): todo criativo que o Automatize cria — wizard,
 * novo anúncio, troca de arte ou de link, Mat, duplicação — pede a EXPANSÃO sem
 * corte ({@link DEFAULT_PLACEMENT_ADAPTATION}), para uma arte enviada num só
 * formato valer em Feed, Reels e Stories. Nenhum recurso que corta
 * ({@link CROPPING_FEATURES}) é pedido. Na conta que a Meta não deixa usar IA
 * generativa (3858023) o plano B é NENHUM recurso — nunca o reenquadramento,
 * que corta. Spec: `docs/superpowers/specs/2026-09-30-placement-expansion-everywhere-design.md`
 * no automatize-frontend.
 *
 * Espelhado no backoffice como cópia BYTE-IDÊNTICA (vive na raiz de
 * `lib/meta-business/`, caminho que existe igual nos dois projetos, para que
 * `duplicate.ts` — que não passa pela reescrita de imports — também possa
 * importá-lo). Módulo puro: sem imports, para continuar idêntico.
 */

/** Valores aceitos por `customizations.image_crop_style` (extraídos do validador da v25). */
export const IMAGE_CROP_STYLES = ["AUTO", "CROP", "EXPAND", "NONE", "ZOOM"] as const;
export type ImageCropStyle = (typeof IMAGE_CROP_STYLES)[number];

/**
 * Reenquadramento: o Meta corta/dá zoom/escolhe a mídia, mas nunca inventa pixel.
 *
 * - `adapt_to_placement` — ajusta a imagem ao posicionamento (o dial de recorte mora aqui)
 * - `pac_relaxation` — mostra a mídia escolhida para um aspect ratio nos demais posicionamentos
 * - `video_auto_crop` — o equivalente para vídeo (corta: ver {@link CROPPING_FEATURES})
 */
export const REFRAMING_FEATURES = [
  "adapt_to_placement",
  "pac_relaxation",
  "video_auto_crop",
] as const;

/**
 * Expansão oficial sem recorte: a IA preenche o canvas que falta.
 *
 * Documentação: Get Started with the Generative AI Features — `image_uncrop`
 * ("Expand image") e `video_uncrop` ("filling the available space instead of
 * cropping or letterboxing").
 */
export const GENERATIVE_FEATURES = ["image_uncrop", "video_uncrop"] as const;

/**
 * Recursos que CORTAM a mídia — proibidos pela regra do produto. A doc da Meta
 * descreve os dois como "cropped and expanded". Saem em `OPT_OUT` explícito
 * sempre que mesclamos com o spec de um criativo existente (duplicação), para a
 * cópia não herdar o corte da origem.
 */
export const CROPPING_FEATURES = ["video_auto_crop", "image_touchups"] as const;

/**
 * Subcode 3858023 — "A conta de anúncios não está qualificada para o Criativo
 * Advantage+". A política da Meta exclui Saúde, Farma, Serviços financeiros e as
 * categorias especiais da IA generativa, e não há como prever pela conta
 * (sondagem de 23/09/2026 numa conta de dentista). O conserto é reativo.
 */
export const GENERATIVE_FEATURES_INELIGIBLE_SUBCODE = 3858023;

/**
 * Subcode 3858028 — "O criativo usa um produto do anúncio que não se qualifica
 * para o Criativo Advantage+" (anúncio dinâmico com `asset_feed_spec`, de
 * oferta…). Sondagem de 30/09/2026 na conta LEG Educação: só a expansão
 * dispara a recusa, e o mesmo criativo sem nada passa. Mesmo plano B do 3858023.
 */
export const ADVANTAGE_CREATIVE_UNSUPPORTED_SUBCODE = 3858028;

/** Recusas da Meta à expansão cujo conserto é o plano B (nenhum recurso). */
export const PLACEMENT_EXPANSION_REFUSED_SUBCODES: readonly number[] = [
  GENERATIVE_FEATURES_INELIGIBLE_SUBCODE,
  ADVANTAGE_CREATIVE_UNSUPPORTED_SUBCODE,
];

export type CreativeFeatureKey =
  | (typeof REFRAMING_FEATURES)[number]
  | (typeof GENERATIVE_FEATURES)[number]
  | (typeof CROPPING_FEATURES)[number];

/** Como o anunciante quer que a mídia seja adaptada entre posicionamentos. */
export type PlacementAdaptation = {
  /** Desligar tudo (o criativo sai sem `degrees_of_freedom_spec`). Padrão: ligado. */
  enabled?: boolean;
  /** Permitir que a IA EXPANDA a mídia para além do quadro original. Padrão: sim. */
  generativeExpansion?: boolean;
  /** Dial de recorte em `adapt_to_placement`. Padrão: `EXPAND` (AUTO/CROP/ZOOM cortam). */
  imageCropStyle?: ImageCropStyle;
};

/** Padrão do produto em todo criativo: expansão sem corte (regra de 30/09/2026). */
export const DEFAULT_PLACEMENT_ADAPTATION: Required<PlacementAdaptation> = {
  enabled: true,
  generativeExpansion: true,
  imageCropStyle: "EXPAND",
};

/** Nome histórico do fluxo de campanha com IA — hoje é o próprio padrão. */
export const AI_PLACEMENT_ADAPTATION: Required<PlacementAdaptation> =
  DEFAULT_PLACEMENT_ADAPTATION;

/** Plano B do 3858023 num criativo novo: sai sem `degrees_of_freedom_spec`. */
export const NO_PLACEMENT_ADAPTATION: PlacementAdaptation = { enabled: false };

type EnrollStatus = { enroll_status: "OPT_IN" | "OPT_OUT" };
type FeatureDetails = EnrollStatus & { customizations?: Record<string, unknown> };

function optOut(): EnrollStatus {
  return { enroll_status: "OPT_OUT" };
}

function resolve(adaptation?: PlacementAdaptation): Required<PlacementAdaptation> {
  return { ...DEFAULT_PLACEMENT_ADAPTATION, ...(adaptation ?? {}) };
}

/**
 * As chaves que queremos ligadas, já com as `customizations` de cada uma.
 *
 * Só emite chaves em `OPT_IN`: o Meta já materializa todas as 82 como `OPT_OUT`
 * por conta própria. Retorna `null` quando a adaptação está desligada — assim o
 * chamador simplesmente não manda o campo.
 */
export function buildCreativeFeaturesSpec(
  adaptation?: PlacementAdaptation,
): Record<string, FeatureDetails> | null {
  const { enabled, generativeExpansion, imageCropStyle } = resolve(adaptation);
  if (!enabled) return null;

  const spec: Record<string, FeatureDetails> = {};
  for (const key of REFRAMING_FEATURES) {
    // video_auto_crop = "cropped and expanded". Com uncrop ligado, mandar os
    // dois pediria corte e expansão ao mesmo tempo.
    if (generativeExpansion && key === "video_auto_crop") continue;
    spec[key] = { enroll_status: "OPT_IN" };
  }
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
 * (o caminho de duplicação): mantém o resto da origem, desliga os
 * {@link CROPPING_FEATURES} que ela tivesse e remove `standard_enhancements`
 * (rejeitado na criação desde a v22).
 */
export function withPlacementAdaptation(
  existing: Record<string, unknown> | undefined,
  adaptation?: PlacementAdaptation,
): Record<string, unknown> | null {
  const ours = buildCreativeFeaturesSpec(adaptation);
  if (!ours) return null;
  const merged: Record<string, unknown> = { ...(existing ?? {}) };
  delete merged.standard_enhancements;
  // Antes das nossas chaves de propósito: quem pede reenquadramento explícito
  // (generativeExpansion: false) ainda recebe o video_auto_crop que pediu.
  for (const key of CROPPING_FEATURES) merged[key] = optOut();
  return Object.assign(merged, ours);
}

function isOptIn(feature: unknown): boolean {
  return (feature as { enroll_status?: unknown } | undefined)?.enroll_status === "OPT_IN";
}

/**
 * Plano B do {@link GENERATIVE_FEATURES_INELIGIBLE_SUBCODE} na duplicação, onde
 * o spec já vem montado (origem + nossas chaves): remove a expansão e deixa
 * adaptação e cortes DESLIGADOS — nunca religa o reenquadramento, que corta.
 * Mantém o resto. Retorna `null` quando nada generativo está ligado: aí a
 * recusa não é essa e não há o que consertar.
 */
export function withoutGenerativeFeatures(
  existing: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!existing || !GENERATIVE_FEATURES.some((key) => isOptIn(existing[key]))) {
    return null;
  }
  const stripped: Record<string, unknown> = { ...existing };
  // Removidas (e não OPT_OUT): é o formato que a Meta aceitou na sondagem ao
  // vivo de 23/09/2026 na conta inelegível.
  for (const key of GENERATIVE_FEATURES) delete stripped[key];
  for (const key of [...REFRAMING_FEATURES, ...CROPPING_FEATURES]) stripped[key] = optOut();
  return stripped;
}

/**
 * Subcode da Meta em qualquer um dos formatos de erro que o código usa:
 * `MetaApiError` (`metaError.error_subcode`), `GraphApiError`
 * (`errorReturn.data.errorSubcode`) ou o corpo cru da Graph (`error.error_subcode`).
 * Duck typing de propósito: o módulo não importa nada.
 */
function metaErrorSubcode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const shaped = error as {
    metaError?: { error_subcode?: unknown };
    errorReturn?: { data?: { errorSubcode?: unknown } };
    error?: { error_subcode?: unknown };
  };
  for (const candidate of [
    shaped.metaError?.error_subcode,
    shaped.errorReturn?.data?.errorSubcode,
    shaped.error?.error_subcode,
  ]) {
    if (typeof candidate === "number") return candidate;
  }
  return undefined;
}

/**
 * A Meta recusou a expansão — conta sem IA generativa (3858023) ou tipo de
 * criativo que não se qualifica (3858028)? Nos dois casos o conserto é o plano B.
 */
export function isGenerativeIneligibleError(error: unknown): boolean {
  const subcode = metaErrorSubcode(error);
  return subcode !== undefined && PLACEMENT_EXPANSION_REFUSED_SUBCODES.includes(subcode);
}

/**
 * Para quem monta o POST /adcreatives à mão: chama `send` com o JSON do spec
 * padrão e, se a Meta recusar a expansão (3858023/3858028), chama `send(null)`
 * UMA vez — o criativo sai sem nenhum recurso. Qualquer outro erro sobe
 * intacto, assim como o erro da segunda tentativa.
 */
export async function withPlacementExpansion<T>(
  send: (degreesOfFreedomSpec: string | null) => Promise<T>,
): Promise<T> {
  const spec = buildDegreesOfFreedomSpec(DEFAULT_PLACEMENT_ADAPTATION);
  try {
    return await send(spec ? JSON.stringify(spec) : null);
  } catch (error) {
    if (!spec || !isGenerativeIneligibleError(error)) throw error;
    console.warn(
      `[placement-expansion] ${metaErrorSubcode(error)}: retry sem degrees_of_freedom_spec`,
    );
    return send(null);
  }
}
