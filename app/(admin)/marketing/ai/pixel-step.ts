/** A pixel as the AI flow lists it. */
export type PixelOption = { id: string; name?: string };

export type PixelStepState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "conflict" }
  | { kind: "empty" }
  | { kind: "list"; justCreated: boolean };

/** Same limit the create route enforces (`creation/create-pixel.ts`). */
export const PIXEL_NAME_MAX_LENGTH = 100;

/**
 * What the pixel step shows. A failed read is NEVER "empty": offering to create on top of a
 * read we could not make would duplicate a pixel Meta does not let anyone delete.
 */
export function pixelStepState(input: {
  loaded: boolean;
  error: string | null;
  pixels: readonly PixelOption[];
  selectedPixelId: string | null;
  createdPixelId: string | null;
  /**
   * Meta answered 409 (the account already has a pixel) to a create made from an empty list.
   * While the re-read stays empty, that pixel is one this connection cannot list, so offering
   * to create again would only loop into another 409.
   */
  conflict: boolean;
}): PixelStepState {
  if (!input.loaded) return { kind: "loading" };
  if (input.error) return { kind: "error", message: input.error };
  if (input.conflict && input.pixels.length === 0) return { kind: "conflict" };
  if (input.pixels.length === 0) return { kind: "empty" };
  return {
    kind: "list",
    justCreated: isJustCreatedPixel(input.selectedPixelId, input.createdPixelId),
  };
}

/** The selected pixel was created in this session — it has no code on the site yet. */
export function isJustCreatedPixel(
  selectedPixelId: string | null,
  createdPixelId: string | null,
): boolean {
  return createdPixelId != null && selectedPixelId === createdPixelId;
}

/** `Pixel – <conta>`: what the create dialog opens with; the operator can change it. */
export function suggestPixelName(accountName: string | null, accountId: string): string {
  const label = accountName?.trim() || accountId;
  return `Pixel – ${label}`.slice(0, PIXEL_NAME_MAX_LENGTH);
}

/**
 * Meta's base pixel code (fbevents.js + PageView), built from the id: it goes in the
 * `fbq('init')` call and in the `<noscript>` fallback image.
 * @see https://developers.facebook.com/docs/meta-pixel/get-started
 */
export function buildPixelBaseCode(pixelId: string): string {
  return [
    "<!-- Meta Pixel Code -->",
    "<script>",
    "!function(f,b,e,v,n,t,s)",
    "{if(f.fbq)return;n=f.fbq=function(){n.callMethod?",
    "n.callMethod.apply(n,arguments):n.queue.push(arguments)};",
    "if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';",
    "n.queue=[];t=b.createElement(e);t.async=!0;",
    "t.src=v;s=b.getElementsByTagName(e)[0];",
    "s.parentNode.insertBefore(t,s)}(window, document,'script',",
    "'https://connect.facebook.net/en_US/fbevents.js');",
    `fbq('init', '${pixelId}');`,
    "fbq('track', 'PageView');",
    "</script>",
    '<noscript><img height="1" width="1" style="display:none"',
    `src="https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1"`,
    "/></noscript>",
    "<!-- End Meta Pixel Code -->",
  ].join("\n");
}
