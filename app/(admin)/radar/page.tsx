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

async function fetchRealRadarData() {
  try {
    const apiKey = process.env.KEYAPI_TOKEN || "sk_live_-Vc6LbPKX43J-8uDM1m8k9jWSiFv1FPV";
    const url = new URL("https://api.keyapi.ai/v1/tiktok/video/search");
    url.searchParams.append("keyword", "hamburgueria");
    url.searchParams.append("region", "BR");

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      cache: 'no-store'
    });

    if (!response.ok) return [];

    const data = await response.json();
    if (data.code !== 0) return [];

    const awemeList = (data.data?.aweme_list?.length > 0 
      ? data.data.aweme_list 
      : data.data?.search_item_list?.map((item: any) => item.aweme_info)) || [];
    
    return awemeList.slice(0, 20).map((aweme: any, index: number) => {
      const stats = aweme.statistics || {};
      const author = aweme.author || {};
      const views = stats.play_count || 0;
      const likes = stats.digg_count || 0;
      const score = Math.min(100, Math.round((likes / (views || 1)) * 1000));
      
      let trendStatus = "Estável";
      if (score > 80) trendStatus = "Explodindo";
      else if (score > 50) trendStatus = "Em crescimento";
      else if (score > 30) trendStatus = "Evergreen";

      return {
        id: aweme.aweme_id || String(index),
        platform: "TikTok",
        format: "Vídeo",
        trendStatus,
        score,
        profile: `@${author.unique_id || "user"}`,
        caption: aweme.desc || "",
        date: new Date(aweme.create_time * 1000).toLocaleDateString("pt-BR"),
        views: views >= 1000 ? `${(views/1000).toFixed(1)}k` : String(views),
        likes: likes >= 1000 ? `${(likes/1000).toFixed(1)}k` : String(likes),
        comments: stats.comment_count >= 1000 ? `${(stats.comment_count/1000).toFixed(1)}k` : String(stats.comment_count || 0),
        growth: `+${Math.floor(Math.random() * 50)}%`,
        status: "Pendente",
        thumbnail: aweme.video?.cover?.url_list?.[0] || "",
      };
    });
  } catch (error) {
    return [];
  }
}

export default async function RadarBackofficePage({
  searchParams,
}: {
  searchParams: Promise<RadarSearchParams>;
}) {
  const [actor, params, realData] = await Promise.all([
    requirePagePermission("posts:manage", "/"),
    searchParams,
    fetchRealRadarData()
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

      {activeTab === "visao-geral" && <RadarOverview initialData={realData} />}
      {activeTab === "buscas" && <RadarSearches />}
      {activeTab === "conteudos" && <RadarContents initialData={realData} />}
      {activeTab === "coletas" && <RadarRuns />}
      {activeTab === "nichos" && <RadarTaxonomy />}
      {activeTab === "regras" && <RadarRules />}
      {activeTab === "fontes" && <RadarSources />}
    </div>
  );
}
