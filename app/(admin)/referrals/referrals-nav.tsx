"use client";

// A navegação da seção de afiliados v2 — UMA barra de abas, sempre a mesma.
//
// Antes cada página tinha botões próprios apontando para as OUTRAS páginas, e
// o conjunto mudava conforme onde você estava — a pior forma de navegação: a
// interface muda de lugar junto com você. Aqui as quatro abas são fixas, na
// mesma ordem, e a atual fica marcada. Quem chega a qualquer página da seção
// vê o mapa inteiro dela.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/referrals", label: "Fila de afiliação" },
  { href: "/referrals/metrics", label: "Métricas" },
  { href: "/referrals/traffic", label: "Tráfego" },
  { href: "/referrals/payouts", label: "Saques" },
] as const;

export function ReferralsNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/referrals"
      ? pathname === "/referrals"
      : (pathname?.startsWith(href) ?? false);

  return (
    <div className="border-b bg-background px-6 pt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Programa de afiliados (v2)
      </p>
      <nav className="-mb-px mt-2 flex gap-6 overflow-x-auto">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors",
              isActive(tab.href)
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
