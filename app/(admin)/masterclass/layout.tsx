import { requirePagePermission } from "@/lib/auth/rbac";

export default async function MasterclassLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("masterclass:manage");
  return children;
}
