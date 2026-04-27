"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PostStats = {
  totalPosts: number;
  postsByType: { type: string; count: number }[];
  totalAiCost: number;
  totalAiTokens: number;
  avgGenerationDuration: number;
  totalAiRequests: number;
  backofficePostCount: number;
};

const ASPECT_RATIO_LABELS: Record<string, string> = {
  "1:1": "Quadrado (1:1)",
  "16:9": "Paisagem (16:9)",
  "9:16": "Retrato (9:16)",
  "4:3": "Padrão (4:3)",
  "3:4": "Retrato (3:4)",
  "21:9": "Ultra-wide (21:9)",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function PostStatsCards({ stats }: { stats: PostStats }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total de Posts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(stats.totalPosts)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Posts do Backoffice
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatNumber(stats.backofficePostCount)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Custo Total IA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(stats.totalAiCost)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tempo Médio de Geração
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.avgGenerationDuration > 0
                ? `${(stats.avgGenerationDuration / 1000).toFixed(1)}s`
                : "N/A"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Posts por Proporção</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.postsByType.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados</p>
            ) : (
              <div className="space-y-2">
                {stats.postsByType.map((item) => (
                  <div key={item.type} className="flex items-center justify-between">
                    <span className="text-sm">
                      {ASPECT_RATIO_LABELS[item.type] ?? item.type}
                    </span>
                    <span className="text-sm font-medium">
                      {formatNumber(item.count)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Resumo de IA</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Requisições totais
                </span>
                <span className="text-sm font-medium">
                  {formatNumber(stats.totalAiRequests)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Tokens totais</span>
                <span className="text-sm font-medium">
                  {formatNumber(stats.totalAiTokens)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Custo total</span>
                <span className="text-sm font-medium">
                  {formatCurrency(stats.totalAiCost)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
