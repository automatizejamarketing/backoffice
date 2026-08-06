import { requirePagePermission } from "@/lib/auth/rbac";

export default async function ReferralsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("affiliates:manage");
  return children;
}
