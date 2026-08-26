export const GATEWAY_TAG = {
  mat: "mat",
  campanha: "campanha",
  imagem: "imagem",
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
