export function buildProductCheckoutUrl(
  frontendAppUrl: string,
  slug: string,
) {
  const origin = frontendAppUrl.trim().replace(/\/+$/, "");
  return `${origin}/produtos/${encodeURIComponent(slug.trim())}`;
}
