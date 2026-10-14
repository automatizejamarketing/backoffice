"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookOpenCheck, Check, LayoutList, MessagesSquare, Pin, Route, Table2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConsultantScopeSelect } from "./consultant-scope";
import { TRAFEGO_VIEWS, VIEW_COOKIE, type TrafegoView } from "./routes";
import { usePrefetchView } from "./use-trafego-data";

const VIEW_ICON: Record<TrafegoView, typeof Route> = { fila: LayoutList, mesa: Table2, jornada: Route };

const SECONDARY: Array<{ href: string; label: string; icon: typeof Route; readsBoard?: boolean }> = [
  { href: "/trafego/playbooks", label: "Playbooks", icon: BookOpenCheck, readsBoard: true },
  { href: "/trafego/mensagens", label: "Mensagens", icon: MessagesSquare },
];

/** Telas em que "Carteira de" muda o que aparece. */
const SCOPED_PATHS = ["/trafego/fila", "/trafego/mesa", "/trafego/jornada", "/trafego/playbooks", "/trafego/adiados"];

const ONE_YEAR = 60 * 60 * 24 * 365;

function viewOf(pathname: string): TrafegoView | null {
  return TRAFEGO_VIEWS.find((view) => pathname === view.href || pathname.startsWith(`${view.href}/`))?.key ?? null;
}

/**
 * Barra da área de Tráfego: a visão (Fila, Mesa, Jornada — cada consultor usa
 * a que preferir), Playbooks e Mensagens, a visão padrão e a carteira.
 * Trocar de visão mantém os filtros da URL.
 */
export function TrafegoTopBar({ defaultView }: { defaultView: TrafegoView | null }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = viewOf(pathname);
  const [savedDefault, setSavedDefault] = useState<TrafegoView | null>(defaultView);
  const query = params.toString();
  const scoped = SCOPED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  // Passar o mouse (ou o foco) num link já aquece os dados da visão: o clique pinta do cache.
  const prefetchView = usePrefetchView();
  const router = useRouter();

  function makeDefault(view: TrafegoView) {
    document.cookie = `${VIEW_COOKIE}=${view}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    setSavedDefault(view);
    const label = TRAFEGO_VIEWS.find((entry) => entry.key === view)?.label ?? view;
    toast.success(`Ao abrir Tráfego, você vai direto para a ${label}`);
  }

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background px-4 py-2 lg:px-5">
      <Link href="/trafego" className="text-sm font-semibold whitespace-nowrap">
        Tráfego
      </Link>
      <nav aria-label="Visão" className="inline-flex h-8 items-center rounded-md border bg-muted/40 p-0.5 text-xs">
        {TRAFEGO_VIEWS.map((view) => {
          const Icon = VIEW_ICON[view.key];
          const active = current === view.key;
          const search = current && query ? query : "";
          const href = search ? `${view.href}?${search}` : view.href;
          const warm = () => {
            prefetchView(view.key, search);
            // A página é fina (não lê nada no servidor): buscar a rota inteira no hover é barato.
            if (!active) router.prefetch(href);
          };
          return (
            <Link
              key={view.key}
              href={href}
              onMouseEnter={warm}
              onFocus={warm}
              title={view.hint}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-full items-center gap-1.5 rounded-[5px] px-2.5 font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                active && "bg-background text-foreground shadow-sm",
              )}
            >
              <Icon className="size-3.5" />
              {view.label}
            </Link>
          );
        })}
      </nav>
      <nav aria-label="Mais da área" className="flex items-center gap-0.5 text-xs">
        {SECONDARY.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onMouseEnter={item.readsBoard ? () => prefetchView("jornada", "") : undefined}
              onFocus={item.readsBoard ? () => prefetchView("jornada", "") : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2 whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                active && "bg-muted font-medium text-foreground",
              )}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        {current ? (
          savedDefault === current ? (
            <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
              <Check className="size-3.5" /> Sua visão padrão
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => makeDefault(current)}
              title="Ao abrir Tráfego, cair direto nesta visão"
            >
              <Pin className="size-3.5" /> Usar como minha visão padrão
            </Button>
          )
        ) : null}
        {scoped ? <ConsultantScopeSelect /> : null}
      </div>
    </header>
  );
}
