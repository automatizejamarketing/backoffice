import { requirePagePermission } from "@/lib/auth/rbac";

export default async function AudienceLibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("marketing:write");
  return children;
}
