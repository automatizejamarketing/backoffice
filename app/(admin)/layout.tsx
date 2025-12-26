import { cookies } from "next/headers";
import { auth } from "@/app/(auth)/auth";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarToggle } from "@/components/sidebar-toggle";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, cookieStore] = await Promise.all([auth(), cookies()]);

  if (!session?.user) {
    redirect("/login");
  }

  const isCollapsed = cookieStore.get("sidebar_state")?.value !== "true";

  return (
    <SidebarProvider defaultOpen={!isCollapsed}>
      <AppSidebar user={session.user} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarToggle />
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-6 md:p-8">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
