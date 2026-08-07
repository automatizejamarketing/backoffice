import { resolveFrontendAppUrl } from "@/lib/env/frontend-app-url";
import { ProductsAdminWorkspace } from "./products-admin-workspace";

export default function ProductsPage() {
  return <ProductsAdminWorkspace frontendAppUrl={resolveFrontendAppUrl()} />;
}
