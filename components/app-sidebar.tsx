"use client";

import { WhatsappIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Briefcase,
  ChevronRight,
  ChevronUp,
  Handshake,
  ImageIcon,
  KanbanSquare,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  LogOut,
  Mail,
  Package,
  Radar,
  Settings2,
  Shield,
  Users,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/(auth)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  hasBackofficePermission,
  type BackofficeActor,
  type BackofficePermission,
  type BackofficeRole,
} from "@/lib/auth/rbac-core";
import { canAccessFinance } from "@/lib/auth/finance-access";
import { cn } from "@/lib/utils";

type User = {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

type NavIcon = ComponentType<{ className?: string }>;

type NavLeaf = {
  kind: "leaf";
  href: string;
  label: string;
  icon: NavIcon;
  permission: BackofficePermission;
  hideForRoles?: BackofficeRole[];
};

type NavChild = {
  href: string;
  label: string;
  permission?: BackofficePermission;
  hideForRoles?: BackofficeRole[];
};

type NavGroup = {
  kind: "group";
  label: string;
  icon: NavIcon;
  children: NavChild[];
};

type NavEntry = NavLeaf | NavGroup;

type NavSection = {
  label?: string;
  entries: NavEntry[];
};

function WhatsappNavIcon({ className }: { className?: string }) {
  return (
    <HugeiconsIcon icon={WhatsappIcon} strokeWidth={2} className={className} />
  );
}

/**
 * Navegação em três blocos, do mais usado para o menos usado:
 *
 * 1. sem rótulo — o dia a dia (painel, carteira, usuários, financeiro);
 * 2. "Marketing" e "Receita" — as frentes de operação;
 * 3. "Mensagens" — histórico de envios.
 *
 * Telas que são passos de um mesmo assunto viram um grupo expansível em vez
 * de um item cada (Criativos, Conteúdo). Regras e Equipe ficam no
 * rodapé porque são configuração, não trabalho recorrente.
 *
 * `/masterclass` saiu daqui: a rota só redireciona para `/products`.
 */
const NAV_SECTIONS: NavSection[] = [
  {
    entries: [
      {
        kind: "leaf",
        href: "/",
        label: "Painel",
        icon: LayoutDashboard,
        permission: "dashboard:view",
      },
      {
        kind: "leaf",
        href: "/portfolio",
        label: "Carteira",
        icon: Briefcase,
        permission: "marketing:read",
      },
      {
        kind: "leaf",
        href: "/users",
        label: "Usuários",
        icon: Users,
        permission: "users:manage",
      },
      {
        kind: "leaf",
        href: "/crm",
        label: "CRM",
        icon: KanbanSquare,
        permission: "users:manage",
      },
      {
        kind: "leaf",
        href: "/finance",
        label: "Financeiro",
        icon: WalletCards,
        permission: "finance:view",
      },
    ],
  },
  {
    label: "Marketing",
    entries: [
      {
        // Operação da coleta Meta: execuções e cobertura conta×dia. Token
        // quebrado é buraco irrecuperável na série, então precisa de um lugar
        // fixo onde apareça no mesmo dia.
        kind: "leaf",
        href: "/marketing/tracking",
        label: "Coleta Meta",
        icon: Radar,
        permission: "marketing:read",
      },
      {
        kind: "group",
        label: "Criativos",
        icon: ImageIcon,
        children: [
          {
            href: "/creative-analysis",
            label: "Análise IA",
            permission: "creative-analysis:manage",
          },
          {
            href: "/criativos-validados",
            label: "Validados",
            permission: "posts:manage",
            hideForRoles: ["finance_viewer"],
          },
        ],
      },
      {
        kind: "leaf",
        href: "/trackable-links",
        label: "Links rastreáveis",
        icon: Link2,
        permission: "trackable-links:manage",
      },
      {
        kind: "group",
        label: "Conteúdo",
        icon: LayoutGrid,
        children: [
          { href: "/posts", label: "Posts", permission: "posts:manage" },
          {
            href: "/video-templates",
            label: "Templates de vídeo",
            permission: "posts:manage",
            hideForRoles: ["finance_viewer"],
          },
          {
            href: "/radar",
            label: "Conteúdos em alta",
            permission: "posts:manage",
          },
        ],
      },
    ],
  },
  {
    label: "Receita",
    entries: [
      {
        // Programa v2 (`referral_*`), o único vivo desde o cutover (ticket 15,
        // ADR 0024). O v1 não tem mais tela que escreva nas tabelas antigas —
        // deixar um atalho aqui convidaria exatamente essa escrita.
        // Fila, métricas, tráfego e saques são abas dentro da própria página,
        // por isso não viram subitens aqui.
        kind: "leaf",
        href: "/referrals",
        label: "Afiliados",
        icon: Handshake,
        permission: "affiliates:manage",
      },
      {
        kind: "leaf",
        href: "/products",
        label: "Produtos",
        icon: Package,
        permission: "products:manage",
      },
    ],
  },
  {
    label: "Mensagens",
    entries: [
      {
        kind: "leaf",
        href: "/emails",
        label: "Emails",
        icon: Mail,
        permission: "emails:view",
      },
      {
        kind: "leaf",
        href: "/whatsapp",
        label: "WhatsApp",
        icon: WhatsappNavIcon,
        permission: "whatsapp:view",
      },
    ],
  },
];

const SETTINGS_ENTRIES: NavLeaf[] = [
  {
    kind: "leaf",
    href: "/business-rules",
    label: "Regras",
    icon: Settings2,
    permission: "business:manage",
  },
  {
    kind: "leaf",
    href: "/team",
    label: "Equipe",
    icon: Shield,
    permission: "team:manage",
  },
];

function isPathActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Entre irmãos com prefixo comum (`/referrals` e `/referrals/metrics`), só o
 * mais específico fica ativo — senão "Solicitações" acenderia junto com
 * qualquer subpágina de afiliados.
 */
function pickActiveChild(pathname: string, children: NavChild[]): string | null {
  const matches = children.filter((child) => isPathActive(pathname, child.href));
  if (matches.length === 0) return null;
  return matches.reduce((best, child) =>
    child.href.length > best.href.length ? child : best,
  ).href;
}

function canSee(
  actor: BackofficeActor,
  item: { permission?: BackofficePermission; hideForRoles?: BackofficeRole[]; href: string },
): boolean {
  if (item.hideForRoles?.includes(actor.role)) return false;
  if (item.href === "/finance" && !canAccessFinance(actor.email)) return false;
  return item.permission ? hasBackofficePermission(actor, item.permission) : true;
}

function filterSections(actor: BackofficeActor): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    entries: section.entries.flatMap<NavEntry>((entry) => {
      if (entry.kind === "leaf") {
        return canSee(actor, entry) ? [entry] : [];
      }
      const children = entry.children.filter((child) => canSee(actor, child));
      if (children.length === 0) return [];
      // Grupo de um filho só vira item simples: expandir para revelar uma
      // única opção é um clique a mais sem informação nova.
      if (children.length === 1) {
        return [
          {
            kind: "leaf",
            href: children[0].href,
            label: entry.label,
            icon: entry.icon,
            permission: children[0].permission ?? "dashboard:view",
          },
        ];
      }
      return [{ ...entry, children }];
    }),
  })).filter((section) => section.entries.length > 0);
}

const menuButtonClass =
  "group-data-[collapsible=icon]:!h-8 group-data-[collapsible=icon]:!w-full group-data-[collapsible=icon]:justify-start";
const activeClass = "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary";

function LeafItem({
  item,
  pathname,
  onNavigate,
}: {
  item: NavLeaf;
  pathname: string;
  onNavigate: () => void;
}) {
  const active = isPathActive(pathname, item.href);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        className={cn(menuButtonClass, active && activeClass)}
        tooltip={item.label}
      >
        <Link
          aria-current={active ? "page" : undefined}
          aria-label={item.label}
          href={item.href}
          onClick={onNavigate}
        >
          <item.icon className="size-4 shrink-0" />
          <span className="min-w-0 truncate group-data-[collapsible=icon]:invisible">
            {item.label}
          </span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

const HOVER_CLOSE_DELAY_MS = 150;

function CollapsedGroupMenu({
  group,
  activeHref,
  onNavigate,
}: {
  group: NavGroup;
  activeHref: string | null;
  onNavigate: () => void;
}) {
  const active = activeHref !== null;
  const [menuOpen, setMenuOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(
      () => setMenuOpen(false),
      HOVER_CLOSE_DELAY_MS,
    );
  };
  useEffect(() => cancelClose, []);

  const isMouse = (event: React.PointerEvent) => event.pointerType === "mouse";

  return (
    <SidebarMenuItem>
      <DropdownMenu modal={false} onOpenChange={setMenuOpen} open={menuOpen}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            aria-label={group.label}
            className={cn(
              menuButtonClass,
              "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
              active && activeClass,
            )}
            onClick={() => {
              cancelClose();
              setMenuOpen(true);
            }}
            onPointerDown={(event) => {
              // Sem isso o Radix alterna no pointerdown e fecha o menu que
              // o hover acabou de abrir.
              if (isMouse(event)) event.preventDefault();
            }}
            onPointerEnter={(event) => {
              if (!isMouse(event)) return;
              cancelClose();
              setMenuOpen(true);
            }}
            onPointerLeave={(event) => {
              if (isMouse(event)) scheduleClose();
            }}
          >
            <group.icon className="size-4 shrink-0" />
            <span className="invisible">{group.label}</span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-44"
          onPointerEnter={cancelClose}
          onPointerLeave={(event) => {
            if (isMouse(event)) scheduleClose();
          }}
          side="right"
          sideOffset={8}
        >
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
            {group.label}
          </DropdownMenuLabel>
          {group.children.map((child) => {
            const childActive = child.href === activeHref;
            return (
              <DropdownMenuItem
                asChild
                className={cn(childActive && "bg-primary/10 text-primary")}
                key={child.href}
              >
                <Link
                  aria-current={childActive ? "page" : undefined}
                  href={child.href}
                  onClick={onNavigate}
                >
                  {child.label}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function GroupItem({
  group,
  pathname,
  collapsed,
  onNavigate,
}: {
  group: NavGroup;
  pathname: string;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const activeHref = pickActiveChild(pathname, group.children);
  const active = activeHref !== null;

  // O grupo segue a navegação: abre ao entrar numa subpágina (link direto,
  // histórico) e fecha ao sair. O clique no cabeçalho vale até a próxima
  // troca de seção — aí a rota volta a mandar.
  const [override, setOverride] = useState<boolean | null>(null);
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    setOverride(null);
  }
  const open = override ?? active;
  const setOpen = (next: (value: boolean) => boolean) =>
    setOverride(next(open));

  // No modo ícone não há espaço para a lista embaixo: as opções abrem num
  // menu ao lado, com o nome do grupo como cabeçalho. Abre no hover e no
  // clique; ao sair com o mouse, espera um instante para a pessoa conseguir
  // atravessar o vão entre o ícone e o menu.
  if (collapsed) {
    return (
      <CollapsedGroupMenu
        group={group}
        activeHref={activeHref}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        aria-expanded={open}
        className={cn(menuButtonClass, active && !open && activeClass)}
        onClick={() => setOpen((value) => !value)}
        tooltip={group.label}
      >
        <group.icon className="size-4 shrink-0" />
        <span className="min-w-0 truncate">{group.label}</span>
        <ChevronRight
          className={cn(
            "ml-auto size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
      </SidebarMenuButton>
      {open ? (
        <SidebarMenuSub>
          {group.children.map((child) => {
            const childActive = child.href === activeHref;
            return (
              <SidebarMenuSubItem key={child.href}>
                <SidebarMenuSubButton
                  asChild
                  className={cn(childActive && activeClass)}
                  isActive={childActive}
                >
                  <Link
                    aria-current={childActive ? "page" : undefined}
                    href={child.href}
                    onClick={onNavigate}
                  >
                    <span>{child.label}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
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
  const closeMobile = () => setOpenMobile(false);

  const sections = filterSections(actor);
  const settings = SETTINGS_ENTRIES.filter((entry) => canSee(actor, entry));

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
              onClick={closeMobile}
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
        {sections.map((section, index) => (
          <SidebarGroup
            key={section.label ?? "primary"}
            className={cn(index > 0 && "pt-0")}
          >
            {section.label ? (
              // No modo ícone o rótulo fica invisível mas continua no lugar,
              // sobreposto ao último item da seção anterior — sem isso ele
              // engole o hover desse item.
              <SidebarGroupLabel className="group-data-[collapsible=icon]:pointer-events-none">
                {section.label}
              </SidebarGroupLabel>
            ) : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {section.entries.map((entry) =>
                  entry.kind === "leaf" ? (
                    <LeafItem
                      key={entry.href}
                      item={entry}
                      pathname={pathname}
                      onNavigate={closeMobile}
                    />
                  ) : (
                    <GroupItem
                      key={entry.label}
                      group={entry}
                      pathname={pathname}
                      collapsed={collapsed}
                      onNavigate={closeMobile}
                    />
                  ),
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="@container">
        {settings.length > 0 ? (
          <SidebarMenu>
            {settings.map((entry) => (
              <LeafItem
                key={entry.href}
                item={entry}
                pathname={pathname}
                onNavigate={closeMobile}
              />
            ))}
          </SidebarMenu>
        ) : null}
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
                  collapsed ? "max-w-72" : "w-(--radix-popper-anchor-width)",
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
