import { requirePagePermission } from "@/lib/auth/rbac";

export default async function PostsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("posts:manage");
  return children;
}
