/**
 * Pixels de conversão do checkout de produto.
 *
 * Cada produto guarda a própria lista (`products.tracking_pixels`). O produtor
 * pode ter uma lista padrão (`expert_profiles.default_tracking_pixels`) que é
 * COPIADA para os produtos dele sem pixel daquele provedor e para os produtos
 * novos — o checkout só lê a lista do produto.
 *
 * Guardamos só IDs validados, nunca o script colado: o checkout é nosso, e JS
 * de terceiro ali leria os dados do comprador. Quem colar o snippet inteiro tem
 * o ID extraído dele.
 *
 * Byte-idêntico em `backoffice/lib/products/tracking-pixels.ts`
 * (`tests/tracking-pixels-parity.test.ts` no frontend).
 */

export const TRACKING_PIXEL_PROVIDERS = [
  "meta",
  "tiktok",
  "google_analytics",
  "google_ads",
] as const;

export type TrackingPixelProvider = (typeof TRACKING_PIXEL_PROVIDERS)[number];

export type TrackingPixel = {
  provider: TrackingPixelProvider;
  pixelId: string;
  /** Só Google Ads: rótulo da ação de conversão de compra. */
  conversionLabel: string | null;
  /** Dispara a compra ao gerar o Pix, antes de o pagamento confirmar. */
  purchaseOnPixGenerated: boolean;
};

export const MAX_TRACKING_PIXELS = 10;

export const TRACKING_PIXEL_PROVIDER_LABELS: Record<
  TrackingPixelProvider,
  string
> = {
  meta: "Meta (Facebook/Instagram)",
  tiktok: "TikTok",
  google_analytics: "Google Analytics 4",
  google_ads: "Google Ads",
};

export const TRACKING_PIXEL_ID_PLACEHOLDERS: Record<
  TrackingPixelProvider,
  string
> = {
  meta: "Ex.: 25666150899674355",
  tiktok: "Ex.: CABCD1234EFGH5678IJ0",
  google_analytics: "Ex.: G-ABC123XYZ9",
  google_ads: "Ex.: AW-123456789",
};

const PIXEL_ID_FORMAT: Record<TrackingPixelProvider, RegExp> = {
  meta: /^\d{10,20}$/,
  tiktok: /^[A-Z0-9]{10,30}$/,
  google_analytics: /^G-[A-Z0-9]{4,20}$/,
  google_ads: /^AW-\d{6,15}$/,
};

/** ID dentro do snippet oficial de cada provedor. */
const SNIPPET_ID: Record<TrackingPixelProvider, RegExp> = {
  meta: /fbq\(\s*['"]init['"]\s*,\s*['"](\d+)['"]/,
  tiktok: /ttq\.load\(\s*['"]([A-Za-z0-9]+)['"]/,
  google_analytics: /\b(G-[A-Za-z0-9]+)\b/,
  google_ads: /\b(AW-\d+)\b/,
};

const CONVERSION_LABEL_FORMAT = /^[A-Za-z0-9_-]{4,64}$/;

function isProvider(value: unknown): value is TrackingPixelProvider {
  return (TRACKING_PIXEL_PROVIDERS as readonly unknown[]).includes(value);
}

function normalizePixelId(provider: TrackingPixelProvider, raw: string) {
  const id = raw.match(SNIPPET_ID[provider])?.[1] ?? raw;
  return provider === "meta" ? id : id.toUpperCase();
}

export function normalizeTrackingPixel(input: unknown): TrackingPixel {
  const value = (input ?? {}) as Record<string, unknown>;
  if (!isProvider(value.provider)) {
    throw new Error("Escolha a plataforma do pixel.");
  }
  const provider = value.provider;
  const label = TRACKING_PIXEL_PROVIDER_LABELS[provider];
  let rawId = typeof value.pixelId === "string" ? value.pixelId.trim() : "";
  let conversionLabel =
    typeof value.conversionLabel === "string"
      ? value.conversionLabel.trim()
      : "";

  // O Google mostra o destino como "AW-123/rotulo"; aceitamos colado inteiro.
  if (provider === "google_ads" && /^AW-\d+\/\S+$/i.test(rawId)) {
    const [id, pastedLabel] = rawId.split("/", 2);
    rawId = id;
    conversionLabel ||= pastedLabel;
  }

  const pixelId = normalizePixelId(provider, rawId);
  if (!pixelId) throw new Error(`Informe o ID do pixel ${label}.`);
  if (!PIXEL_ID_FORMAT[provider].test(pixelId)) {
    throw new Error(
      `"${pixelId.slice(0, 40)}" não é um ID válido de ${label}. ${TRACKING_PIXEL_ID_PLACEHOLDERS[provider]}.`,
    );
  }
  if (provider === "google_ads" && !CONVERSION_LABEL_FORMAT.test(conversionLabel)) {
    throw new Error(
      `Informe o rótulo da conversão de compra do Google Ads (${pixelId}).`,
    );
  }

  return {
    provider,
    pixelId,
    conversionLabel: provider === "google_ads" ? conversionLabel : null,
    purchaseOnPixGenerated: value.purchaseOnPixGenerated === true,
  };
}

function pixelKey(pixel: TrackingPixel) {
  return `${pixel.provider}:${pixel.pixelId}:${pixel.conversionLabel ?? ""}`;
}

/** Valida a lista inteira; repetidos ficam uma vez só. */
export function parseTrackingPixels(input: unknown): TrackingPixel[] {
  if (input === null || input === undefined) return [];
  if (!Array.isArray(input)) throw new Error("Lista de pixels inválida.");
  const pixels = new Map<string, TrackingPixel>();
  for (const item of input) {
    const pixel = normalizeTrackingPixel(item);
    if (!pixels.has(pixelKey(pixel))) pixels.set(pixelKey(pixel), pixel);
  }
  if (pixels.size > MAX_TRACKING_PIXELS) {
    throw new Error(`Cadastre no máximo ${MAX_TRACKING_PIXELS} pixels.`);
  }
  return [...pixels.values()];
}

/**
 * Leitura tolerante do que já está no banco: entrada inválida é descartada em
 * vez de derrubar o checkout.
 */
export function readStoredTrackingPixels(value: unknown): TrackingPixel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    try {
      return [normalizeTrackingPixel(item)];
    } catch {
      return [];
    }
  });
}

function sameProviderPixels(
  left: readonly TrackingPixel[],
  right: readonly TrackingPixel[],
) {
  const signature = (pixels: readonly TrackingPixel[]) =>
    pixels
      .map((pixel) => `${pixelKey(pixel)}:${pixel.purchaseOnPixGenerated}`)
      .sort()
      .join("|");
  return signature(left) === signature(right);
}

/**
 * Pixels padrão do produtor aplicados a um produto, provedor a provedor:
 * - produto sem pixel daquele provedor recebe o padrão;
 * - produto ainda idêntico ao padrão anterior acompanha a troca (ou remoção);
 * - pixel escolhido no produto nunca é trocado.
 */
export function applyDefaultTrackingPixels(
  current: readonly TrackingPixel[],
  defaults: readonly TrackingPixel[],
  previousDefaults: readonly TrackingPixel[] = [],
): TrackingPixel[] {
  const providers = new Set(
    [...defaults, ...previousDefaults].map((pixel) => pixel.provider),
  );
  let next = [...current];
  for (const provider of providers) {
    const own = current.filter((pixel) => pixel.provider === provider);
    const previous = previousDefaults.filter(
      (pixel) => pixel.provider === provider,
    );
    if (own.length > 0 && !sameProviderPixels(own, previous)) continue;
    next = [
      ...next.filter((pixel) => pixel.provider !== provider),
      ...defaults.filter((pixel) => pixel.provider === provider),
    ];
  }
  return next.slice(0, MAX_TRACKING_PIXELS);
}

export function sameTrackingPixels(
  left: readonly TrackingPixel[],
  right: readonly TrackingPixel[],
) {
  return sameProviderPixels(left, right);
}

/** Token da API de Conversões da Meta: `EAA…`, só letras, dígitos, `_` e `-`. */
const CONVERSIONS_API_TOKEN_FORMAT = /^[A-Za-z0-9_-]{30,2000}$/;

export type ConversionsApiTokenChange = {
  pixelId: string;
  /** `null` remove o token salvo. */
  accessToken: string | null;
};

/**
 * Mudanças de token da API de Conversões vindas do editor de pixels. O token
 * nunca entra em `tracking_pixels` (que vai para o navegador): cada linha Meta
 * pode trazer `capiAccessToken` — texto grava, `null` remove, ausente mantém.
 */
export function parseConversionsApiTokenChanges(
  input: unknown,
): ConversionsApiTokenChange[] {
  if (!Array.isArray(input)) return [];
  const changes = new Map<string, string | null>();
  for (const item of input) {
    const value = (item ?? {}) as Record<string, unknown>;
    if (value.provider !== "meta" || !("capiAccessToken" in value)) continue;
    const raw = value.capiAccessToken;
    if (raw !== null && typeof raw !== "string") continue;
    const token = typeof raw === "string" ? raw.trim() : null;
    if (token === "") continue;
    const { pixelId } = normalizeTrackingPixel(item);
    if (token !== null && !CONVERSIONS_API_TOKEN_FORMAT.test(token)) {
      throw new Error(
        `O token da API de Conversões do pixel ${pixelId} não parece válido. Copie o token inteiro gerado no Gerenciador de Eventos.`,
      );
    }
    changes.set(pixelId, token);
  }
  return [...changes].map(([pixelId, accessToken]) => ({
    pixelId,
    accessToken,
  }));
}
