import { ProductsAdminWorkspace } from "./products-admin-workspace";

export default function ProductsPage() {
  const frontendAppUrl = (
    process.env.FRONTEND_APP_URL ??
    process.env.NEXT_PUBLIC_FRONTEND_APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://www.automatizemarketing.com"
  ).replace(/\/+$/, "");

  return <ProductsAdminWorkspace frontendAppUrl={frontendAppUrl} />;
}
