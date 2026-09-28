import { resolveFrontendAppUrl } from "@/lib/env/frontend-app-url";
import { ProductsAdminWorkspace } from "./products-admin-workspace";

const TABS = new Set(["dashboard", "products", "experts", "orders", "recovery"]);

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const tab = typeof query.tab === "string" && TABS.has(query.tab) ? query.tab : "products";
  const expert = typeof query.expert === "string" ? query.expert : null;
  return (
    <ProductsAdminWorkspace
      frontendAppUrl={resolveFrontendAppUrl()}
      initialTab={tab}
      openExpertId={expert}
    />
  );
}
