import { requirePagePermission } from "@/lib/auth/rbac";

export default async function ProductsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("products:manage");
  return children;
}

