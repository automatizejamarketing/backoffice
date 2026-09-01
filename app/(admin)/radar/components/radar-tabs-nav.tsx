"use client";

import Link from "next/link";
import { 
  LayoutDashboard, 
  Search, 
  Image as ImageIcon, 
  Activity, 
  Tags, 
  Settings2, 
  Database 
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RadarTab } from "../page";

const TAB_CONFIG: Array<{
  value: RadarTab;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { value: "visao-geral", label: "Visão geral", icon: LayoutDashboard },
  { value: "buscas", label: "Buscas", icon: Search },
  { value: "conteudos", label: "Conteúdos", icon: ImageIcon },
  { value: "coletas", label: "Coletas", icon: Activity },
  { value: "nichos", label: "Nichos e termos", icon: Tags },
  { value: "regras", label: "Regras de publicação", icon: Settings2 },
  { value: "fontes", label: "Fontes e consumo", icon: Database },
];

export function RadarTabsNav({ activeTab }: { activeTab: RadarTab }) {
  return (
    <div className="space-y-4">
      <nav className="overflow-x-auto border-b pb-px">
        <div className="flex min-w-max gap-1">
          {TAB_CONFIG.map((tab) => {
            const Icon = tab.icon;
            const active = tab.value === activeTab;
            return (
              <Link
                key={tab.value}
                href={`/radar?tab=${tab.value}`}
                className={cn(
                  "inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
