/**
 * One tag per Gateway request. Keep slugs aligned with automatize-frontend:
 * `mat-*` is the Eve agent; `ai-*` is a direct model call.
 */
export const GATEWAY_TAG = {
  aiCampanhaCopy: "ai-campanha-copy",
  aiImagem: "ai-imagem",
  aiLegenda: "ai-legenda",
} as const;

export type GatewayTag = (typeof GATEWAY_TAG)[keyof typeof GATEWAY_TAG];

export function gatewayProviderOptions(
  tag: GatewayTag,
  extra?: { user?: string },
) {
  return {
    gateway: {
      tags: [tag],
      ...(extra?.user ? { user: extra.user } : {}),
    },
  };
}
