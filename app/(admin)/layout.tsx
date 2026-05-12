import { cookies } from "next/headers";
import { auth } from "@/app/(auth)/auth";
import { getCurrentBackofficeActor } from "@/lib/auth/rbac";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarToggle } from "@/components/sidebar-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, actor, cookieStore] = await Promise.all([
    auth(),
    getCurrentBackofficeActor(),
    cookies(),
  ]);

  if (!actor) {
    redirect("/login");
  }

  const isCollapsed = cookieStore.get("sidebar_state")?.value !== "true";
  const sidebarUser = {
    id: session?.user?.id ?? actor.id,
    email: session?.user?.email ?? actor.email,
    name: session?.user?.name ?? actor.name ?? null,
    image: session?.user?.image ?? null,
  };

  return (
    <SidebarProvider defaultOpen={!isCollapsed}>
      <AppSidebar user={sidebarUser} actor={actor} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
          <SidebarToggle />
          <ThemeToggle />
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-6 md:p-8">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
