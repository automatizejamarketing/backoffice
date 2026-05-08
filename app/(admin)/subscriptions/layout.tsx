import { requirePagePermission } from "@/lib/auth/rbac";

export default async function SubscriptionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("billing:manage");
  return children;
}
