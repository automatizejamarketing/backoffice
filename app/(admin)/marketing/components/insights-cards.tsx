"use client";

import { useState } from "react";
import {
  CircleHelp,
  DollarSign,
  Eye,
  MousePointerClick,
  TrendingUp,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import type { InsightsMetrics } from "@/lib/meta-business/types";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
} from "../utils/formatters";

type MetricInfo = {
  fullTitle: string;
  description: string;
  tip?: string;
};

const METRIC_INFO: Record<string, MetricInfo> = {
  impressions: {
    fullTitle: "Impressões:",
    description:
      "Representa o número total de vezes que o seu anúncio foi exibido na tela dos usuários. Uma mesma pessoa pode gerar múltiplas impressões ao ver o anúncio mais de uma vez. Essa métrica é fundamental para entender o volume de exposição da sua campanha.",
  },
  reach: {
    fullTitle: "Alcance:",
    description:
      "Indica o número de pessoas únicas que visualizaram o seu anúncio. Diferente das impressões, o alcance conta cada pessoa apenas uma vez, independentemente de quantas vezes ela viu o anúncio. Essa métrica ajuda a entender quantas pessoas diferentes sua campanha está atingindo.",
  },
  CPC: {
    fullTitle: "Custo por Clique (CPC):",
    description:
      "Mede o valor médio pago por cada clique no seu anúncio. Essa métrica indica o nível de atratividade do seu criativo (vídeo ou imagem) e o quanto ele desperta curiosidade na audiência. Quando o CPC está abaixo de R$1,00, geralmente significa que o anúncio está chamando atenção e o gancho está funcionando bem.",
    tip: "Se o CPC estiver alto, teste criativos mais impactantes. Mostre a solução do seu produto nos primeiros 3 segundos do vídeo ou utilize uma chamada forte e direta no título da imagem para aumentar o interesse imediato.",
  },
  CTR: {
    fullTitle: "Taxa de Cliques (CTR):",
    description:
      "Representa a proporção de cliques em relação ao número total de impressões do anúncio. Essa métrica mostra o quanto seu anúncio é relevante para o público que está sendo impactado. Um CTR acima de 1% costuma indicar que o anúncio está atrativo e alinhado com a audiência.",
    tip: "Se o CTR estiver abaixo de 1%, considere trocar o criativo. Foque menos nas características do produto e mais na transformação, benefício ou experiência que ele proporciona para o cliente.",
  },
  CPM: {
    fullTitle: "Custo por Mil Impressões (CPM):",
    description:
      "Indica o valor pago a cada mil exibições do seu anúncio. Essa métrica está diretamente relacionada à concorrência do público escolhido. Quanto maior o CPM, maior tende a ser a disputa no leilão de anúncios para aquele público.",
    tip: "Se o CPM estiver muito alto, avalie testar novos públicos, ampliar segmentações ou ajustar a estratégia para evitar leilões excessivamente concorridos e reduzir custos.",
  },
};

type InsightsCardsProps = {
  insights?: InsightsMetrics;
  isLoading?: boolean;
};

export function InsightsCards({
  insights,
  isLoading = false,
}: InsightsCardsProps) {
  if (isLoading) {
    return <InsightsCardsSkeleton />;
  }

  const metrics: {
    label: string;
    value: string;
    icon: typeof DollarSign;
    color: string;
    info?: MetricInfo;
  }[] = [
    {
      label: "Gasto Total",
      value: formatCurrency(insights?.spend),
      icon: DollarSign,
      color: "text-emerald-500",
    },
    {
      label: "Impressões",
      value: formatNumber(insights?.impressions),
      icon: Eye,
      color: "text-blue-500",
      info: METRIC_INFO.impressions,
    },
    {
      label: "Cliques",
      value: formatNumber(insights?.clicks),
      icon: MousePointerClick,
      color: "text-violet-500",
    },
    {
      label: "Alcance",
      value: formatNumber(insights?.reach),
      icon: Users,
      color: "text-orange-500",
      info: METRIC_INFO.reach,
    },
    {
      label: "CPC",
      value: formatCurrency(insights?.cpc),
      icon: TrendingUp,
      color: "text-cyan-500",
      info: METRIC_INFO.CPC,
    },
    {
      label: "CTR",
      value: formatPercentage(insights?.ctr),
      icon: MousePointerClick,
      color: "text-pink-500",
      info: METRIC_INFO.CTR,
    },
    {
      label: "CPM",
      value: formatCurrency(insights?.cpm),
      icon: DollarSign,
      color: "text-amber-500",
      info: METRIC_INFO.CPM,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
      {metrics.map((metric) => (
        <Card key={metric.label} className="bg-card">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <metric.icon className={`size-4 shrink-0 ${metric.color}`} />
              <span className="text-xs text-muted-foreground truncate">
                {metric.label}
              </span>
              {metric.info && (
                <MetricInfoButton
                  fullTitle={metric.info.fullTitle}
                  description={metric.info.description}
                  tip={metric.info.tip}
                />
              )}
            </div>
            <p className="text-lg sm:text-xl font-semibold tabular-nums">
              {metric.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MetricInfoButton({
  fullTitle,
  description,
  tip,
}: {
  fullTitle: string;
  description: string;
  tip?: string;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="ml-auto shrink-0 inline-flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <CircleHelp className="size-3.5 text-muted-foreground" />
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{fullTitle}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {tip && (
            <p className="text-sm">
              <span className="font-semibold">DICA: </span>
              {tip}
            </p>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="ml-auto shrink-0 inline-flex items-center justify-center"
          >
            <CircleHelp className="size-3.5 text-muted-foreground" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-2">
            <p>
              <span className="font-semibold">{fullTitle} </span>
              {description}
            </p>
            {tip && (
              <p>
                <span className="font-semibold">DICA: </span>
                {tip}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function InsightsCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
      {Array.from({ length: 7 }).map((_, i) => (
        <Card key={i} className="bg-card">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="h-6 w-16 mt-1" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
