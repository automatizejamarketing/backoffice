"use client";

import {
  Briefcase,
  ChevronUp,
  Handshake,
  GraduationCap,
  Image,
  LayoutDashboard,
  LogOut,
  Settings2,
  Shield,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/(auth)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  hasBackofficePermission,
  type BackofficeActor,
  type BackofficePermission,
} from "@/lib/auth/rbac-core";
import { cn } from "@/lib/utils";

type User = {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  isActive: boolean;
  permission?: BackofficePermission;
  consultantOnly?: boolean;
};

export function AppSidebar({
  user,
  actor,
}: {
  user: User;
  actor: BackofficeActor;
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  const isDashboard = pathname === "/";
  const isPortfolioSection = pathname?.startsWith("/portfolio");
  const isUsersSection = pathname?.startsWith("/users");
  const isPostsSection = pathname?.startsWith("/posts");
  const isAffiliatesSection = pathname?.startsWith("/affiliates");
  const isMasterclassSection = pathname?.startsWith("/masterclass");
  const isTeamSection = pathname?.startsWith("/team");
  const isBusinessRulesSection = pathname?.startsWith("/business-rules");

  const allNavItems: NavItem[] = [
    {
      href: "/",
      label: "Painel",
      icon: LayoutDashboard,
      isActive: isDashboard,
      permission: "dashboard:view",
    },
    {
      href: "/portfolio",
      label: "Carteira",
      icon: Briefcase,
      isActive: isPortfolioSection,
      permission: "marketing:read",
    },
    {
      href: "/business-rules",
      label: "Regras",
      icon: Settings2,
      isActive: isBusinessRulesSection,
      permission: "business:manage",
    },
    {
      href: "/users",
      label: "Usuários",
      icon: Users,
      isActive: isUsersSection,
      permission: "users:manage",
    },
    {
      href: "/posts",
      label: "Conteúdo",
      icon: Image,
      isActive: isPostsSection,
      permission: "posts:manage",
    },
    {
      href: "/affiliates",
      label: "Afiliados",
      icon: Handshake,
      isActive: isAffiliatesSection,
      permission: "affiliates:manage",
    },
    {
      href: "/masterclass",
      label: "Masterclass",
      icon: GraduationCap,
      isActive: isMasterclassSection,
      permission: "masterclass:manage",
    },
    {
      href: "/team",
      label: "Equipe",
      icon: Shield,
      isActive: isTeamSection,
      permission: "team:manage",
    },
  ];

  const navItems = allNavItems.filter((item) => {
    if (item.consultantOnly && actor.role !== "marketing_consultant") {
      return false;
    }
    return item.permission
      ? hasBackofficePermission(actor, item.permission)
      : true;
  });

  return (
    <Sidebar className="group-data-[side=left]:border-r-0">
      <SidebarHeader>
        <SidebarMenu>
          <div className="flex flex-row items-center justify-between">
            <Link
              className="flex flex-row items-center rounded-md hover:bg-muted transition-colors p-2"
              href={actor.role === "marketing_consultant" ? "/portfolio" : "/"}
              onClick={() => {
                setOpenMobile(false);
              }}
            >
              {/* Logo for light mode */}
              {/* biome-ignore lint/a11y/useAltText: Alt text provided */}
              <img
                alt="AutomatizeJá Backoffice"
                className="block dark:hidden"
                src="/logo/3.png"
                style={{ height: 28, width: "auto" }}
              />
              {/* Logo for dark mode */}
              {/* biome-ignore lint/a11y/useAltText: Alt text provided */}
              <img
                alt="AutomatizeJá Backoffice"
                className="hidden dark:block"
                src="/logo/9.png"
                style={{ height: 28, width: "auto" }}
              />
            </Link>
          </div>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    className={cn(
                      item.isActive && "bg-primary/10 text-primary",
                    )}
                  >
                    <Link href={item.href} onClick={() => setOpenMobile(false)}>
                      <item.icon className="size-4" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  className="h-10 bg-background data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  data-testid="user-nav-button"
                >
                  <Avatar className="h-6 w-6">
                    <AvatarImage
                      src={user.image ?? undefined}
                      alt={user.name ?? "Avatar do Admin"}
                    />
                    <AvatarFallback className="text-xs">
                      {user.name?.charAt(0) ?? user.email?.charAt(0) ?? "A"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate" data-testid="user-email">
                    {user.email}
                  </span>
                  <ChevronUp className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-popper-anchor-width)"
                side="top"
              >
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">
                    {user.name ?? (actor.role === "admin" ? "Admin" : "Consultor")}
                  </p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <form action={signOutAction} className="w-full">
                    <button
                      type="submit"
                      className="flex w-full cursor-pointer items-center gap-2"
                    >
                      <LogOut className="size-4" />
                      Sair
                    </button>
                  </form>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
