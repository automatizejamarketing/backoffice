import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/rbac";
import { RadarTabsNav } from "./components/radar-tabs-nav";
import { RadarOverview } from "./components/radar-overview";
import { RadarSearches } from "./components/radar-searches";
import { RadarContents } from "./components/radar-contents";
import { RadarRuns } from "./components/radar-runs";
import { RadarTaxonomy } from "./components/radar-taxonomy";
import { RadarRules } from "./components/radar-rules";
import { RadarSources } from "./components/radar-sources";

export const dynamic = "force-dynamic";

export type RadarTab = 
  | "visao-geral"
  | "buscas"
  | "conteudos"
  | "coletas"
  | "nichos"
  | "regras"
  | "fontes";

type RadarSearchParams = {
  tab?: RadarTab;
};

export default async function RadarBackofficePage({
  searchParams,
}: {
  searchParams: Promise<RadarSearchParams>;
}) {
  const [actor, params] = await Promise.all([
    requirePagePermission("posts:manage", "/"),
    searchParams,
  ]);

  const activeTab = params.tab ?? "visao-geral";

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-8 p-6">
      <header className="space-y-6">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-blue-500" />
            Curadoria e Inteligência
          </div>
          <div className="mt-2 flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Radar de Conteúdos
            </h1>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Configure buscas, acompanhe coletas e controle os conteúdos exibidos aos clientes.
          </p>
        </div>

        <RadarTabsNav activeTab={activeTab} />
      </header>

      {activeTab === "visao-geral" && <RadarOverview />}
      {activeTab === "buscas" && <RadarSearches />}
      {activeTab === "conteudos" && <RadarContents />}
      {activeTab === "coletas" && <RadarRuns />}
      {activeTab === "nichos" && <RadarTaxonomy />}
      {activeTab === "regras" && <RadarRules />}
      {activeTab === "fontes" && <RadarSources />}
    </div>
  );
}
