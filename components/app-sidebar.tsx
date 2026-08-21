"use client";

import { WhatsappIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentType } from "react";
import {
  Briefcase,
  ChevronUp,
  Handshake,
  GraduationCap,
  Image,
  LayoutDashboard,
  Link2,
  LogOut,
  Mail,
  WalletCards,
  Radar,
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
import { canAccessFinance } from "@/lib/auth/finance-access";
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
  icon: ComponentType<{ className?: string }>;
  isActive: boolean;
  permission?: BackofficePermission;
  consultantOnly?: boolean;
};

function WhatsappNavIcon({ className }: { className?: string }) {
  return (
    <HugeiconsIcon
      icon={WhatsappIcon}
      strokeWidth={2}
      className={className}
    />
  );
}

export function AppSidebar({
  user,
  actor,
}: {
  user: User;
  actor: BackofficeActor;
}) {
  const pathname = usePathname();
  const { setOpenMobile, state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;

  const isDashboard = pathname === "/";
  const isFinanceSection = pathname?.startsWith("/finance");
  const isEmailsSection = pathname?.startsWith("/emails");
  const isWhatsappSection = pathname?.startsWith("/whatsapp");
  const isPortfolioSection = pathname?.startsWith("/portfolio");
  const isUsersSection = pathname?.startsWith("/users");
  const isPostsSection = pathname?.startsWith("/posts");
  const isReferralsSection = pathname?.startsWith("/referrals");
  const isTrackableLinksSection = pathname?.startsWith("/trackable-links");
  const isProductsSection = pathname?.startsWith("/products");
  const isTeamSection = pathname?.startsWith("/team");
  const isBusinessRulesSection = pathname?.startsWith("/business-rules");
  const isMetaTrackingSection = pathname?.startsWith("/marketing/tracking");

  const allNavItems: NavItem[] = [
    {
      href: "/",
      label: "Painel",
      icon: LayoutDashboard,
      isActive: isDashboard,
      permission: "dashboard:view",
    },
    {
      href: "/finance",
      label: "Financeiro",
      icon: WalletCards,
      isActive: isFinanceSection,
      permission: "finance:view",
    },
    {
      href: "/portfolio",
      label: "Carteira",
      icon: Briefcase,
      isActive: isPortfolioSection,
      permission: "marketing:read",
    },
    {
      // Operação da coleta Meta: execuções e cobertura conta×dia. Token
      // quebrado é buraco irrecuperável na série, então precisa de um lugar
      // fixo onde apareça no mesmo dia.
      href: "/marketing/tracking",
      label: "Coleta Meta",
      icon: Radar,
      isActive: isMetaTrackingSection,
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
      href: "/emails",
      label: "Emails",
      icon: Mail,
      isActive: isEmailsSection,
      permission: "emails:view",
    },
    {
      href: "/whatsapp",
      label: "WhatsApp",
      icon: WhatsappNavIcon,
      isActive: isWhatsappSection,
      permission: "whatsapp:view",
    },
    {
      href: "/posts",
      label: "Conteúdo",
      icon: Image,
      isActive: isPostsSection,
      permission: "posts:manage",
    },
    {
      // Programa v2 (`referral_*`), o único vivo desde o cutover (ticket 15,
      // ADR 0024). A entrada do v1 saiu daqui junto com o runtime dele: as
      // tabelas antigas continuam no banco, mas não há mais tela que escreva
      // nelas — deixar o atalho na navegação convidaria exatamente essa escrita.
      href: "/referrals",
      label: "Afiliados",
      icon: Handshake,
      isActive: isReferralsSection,
      permission: "affiliates:manage",
    },
    {
      href: "/trackable-links",
      label: "Links Rastreáveis",
      icon: Link2,
      isActive: isTrackableLinksSection,
      permission: "trackable-links:manage",
    },
    {
      href: "/products",
      label: "Produtos",
      icon: GraduationCap,
      isActive: isProductsSection,
      permission: "products:manage",
    },
    {
      href: "/video-templates",
      label: "Templates Vídeo",
      icon: Image,
      isActive: pathname.startsWith("/video-templates"),
      permission: "posts:manage",
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
    if (item.href === "/finance" && !canAccessFinance(actor.email)) {
      return false;
    }
    if (item.href === "/video-templates") {
      return actor.role !== "finance_viewer";
    }
    return item.permission
      ? hasBackofficePermission(actor, item.permission)
      : true;
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <div className="flex flex-row items-center justify-between">
            <Link
              aria-label="AutomatizeJá Backoffice"
              className="flex items-center gap-1.5 overflow-hidden rounded-md p-2 transition-colors hover:bg-muted group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-1"
              href={
                actor.role === "marketing_consultant"
                  ? "/portfolio"
                  : actor.role === "finance_viewer"
                    ? "/finance"
                    : "/"
              }
              onClick={() => {
                setOpenMobile(false);
              }}
            >
              {/* biome-ignore lint/a11y/useAltText: Decorative; label is on the link */}
              <img
                alt=""
                className="size-7 shrink-0 object-contain"
                src="/logo/1.png"
              />
              <span className="relative h-7 w-[168px] shrink-0 overflow-hidden group-data-[collapsible=icon]:invisible">
                {/* biome-ignore lint/a11y/useAltText: Decorative; label is on the link */}
                <img
                  alt=""
                  className="absolute top-1/2 -left-4 h-[110px] max-w-none -translate-y-1/2"
                  src="/logo/2.png"
                />
              </span>
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
                      "group-data-[collapsible=icon]:!h-8 group-data-[collapsible=icon]:!w-full group-data-[collapsible=icon]:justify-start",
                      item.isActive && "bg-primary/10 text-primary",
                    )}
                    tooltip={item.label}
                  >
                    <Link href={item.href} onClick={() => setOpenMobile(false)}>
                      <item.icon className="size-4 shrink-0" />
                      <span className="min-w-0 truncate group-data-[collapsible=icon]:invisible">
                        {item.label}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="@container">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  className="h-10 bg-background data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:!h-8 group-data-[collapsible=icon]:!w-full group-data-[collapsible=icon]:justify-start @max-[3.5rem]:!justify-center @max-[3.5rem]:!p-0"
                  data-testid="user-nav-button"
                >
                  <Avatar className="size-6 shrink-0">
                    <AvatarImage
                      src={user.image ?? undefined}
                      alt={user.name ?? "Avatar do Admin"}
                    />
                    <AvatarFallback className="text-xs uppercase">
                      {user.name?.charAt(0) ?? user.email?.charAt(0) ?? "A"}
                    </AvatarFallback>
                  </Avatar>
                  <span
                    className="min-w-0 truncate group-data-[collapsible=icon]:invisible @max-[3.5rem]:hidden"
                    data-testid="user-email"
                  >
                    {user.email}
                  </span>
                  <ChevronUp className="ml-auto shrink-0 group-data-[collapsible=icon]:invisible @max-[3.5rem]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align={collapsed ? "end" : "start"}
                className={cn(
                  "min-w-56",
                  collapsed
                    ? "max-w-72"
                    : "w-(--radix-popper-anchor-width)",
                )}
                side={collapsed ? "right" : "top"}
                sideOffset={collapsed ? 8 : 4}
              >
                <div className="px-2 py-1.5">
                  <p className="truncate text-sm font-medium">
                    {user.name ??
                      (actor.role === "admin"
                        ? "Admin"
                        : actor.role === "dev"
                          ? "Dev"
                          : actor.role === "finance_viewer"
                            ? "Financeiro"
                            : "Consultor")}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </p>
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
