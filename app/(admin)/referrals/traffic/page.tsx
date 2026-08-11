"use client";

// Tráfego do programa de afiliados v2 — de onde vêm os cliques.
//
// O layout copia a gramática do Vercel Analytics: dois cartões grandes de
// origem em cima, três cartões de ambiente embaixo, cada linha com barra
// proporcional. Três decisões de apresentação carregam o resto:
//
//   * **Os números principais são de VISITANTES, não de cliques.** Clique
//     conta F5; visitante é `visitor_id` distinto. Os cliques ficam no card de
//     resumo e no tooltip de cada linha.
//   * **Robôs de preview ficam num painel próprio, fora de todas as somas.**
//     O servidor do WhatsApp busca toda URL colada numa conversa; contar esse
//     fetch como clique é exatamente a inflação que este painel veio corrigir.
//   * **Cadastros aparecem por linha.** "De onde vem tráfego" é curiosidade;
//     "de onde vêm cadastros" é decisão de onde divulgar mais.

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  REFERRAL_TRAFFIC_RANGE_LABELS,
  REFERRAL_TRAFFIC_RANGE_VALUES,
  type ReferralTrafficRange,
} from "@/lib/referral/traffic";
import type { ReferralTrafficResponse } from "@/lib/referral/traffic-queries";
import {
  TrafficList,
  formatInt,
} from "@/components/referral-traffic/traffic-panels";

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function ReferralTrafficPage() {
  const [report, setReport] = useState<ReferralTrafficResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<ReferralTrafficRange>("30");
  const [affiliateId, setAffiliateId] = useState<string>("all");

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ range });
      if (affiliateId !== "all") params.set("affiliate", affiliateId);
      const response = await fetch(`/api/referrals/traffic?${params}`);
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || "Erro ao carregar o tráfego");
        return;
      }
      setReport(data);
    } catch {
      toast.error("Erro ao carregar o tráfego");
    } finally {
      setLoading(false);
    }
  }, [range, affiliateId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tráfego</h1>
        <p className="text-sm text-muted-foreground">
          De onde vêm os cliques e os cadastros. Números principais contam
          visitantes únicos; robôs de preview ficam fora de todas as somas.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={range}
          onValueChange={(value) => setRange(value as ReferralTrafficRange)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Período" />
          </SelectTrigger>
          <SelectContent>
            {REFERRAL_TRAFFIC_RANGE_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {REFERRAL_TRAFFIC_RANGE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={affiliateId} onValueChange={setAffiliateId}>
          <SelectTrigger className="w-[280px]">
            <SelectValue placeholder="Afiliado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os afiliados</SelectItem>
            {(report?.affiliates ?? []).map((affiliate) => (
              <SelectItem key={affiliate.id} value={affiliate.id}>
                {affiliate.name || affiliate.email} · {affiliate.code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading && !report ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !report ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Não foi possível carregar o tráfego.
        </p>
      ) : (
        <>
          {report.truncated && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              O período tem mais cliques do que o painel lê de uma vez — os
              números abaixo cobrem os 100 mil mais recentes. Encurte o período
              para o recorte completo.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Visitantes únicos"
              value={formatInt(report.totals.visitors)}
              hint="visitor_id distintos, sem robôs"
            />
            <Stat
              label="Cliques"
              value={formatInt(report.totals.clicks)}
              hint="Chegadas com ?ref= — F5 conta de novo"
            />
            <Stat
              label="Cadastros"
              value={formatInt(report.totals.signups)}
              hint="Atribuições vencedoras de cliques deste recorte"
            />
            <Stat
              label="Robôs filtrados"
              value={formatInt(report.totals.botClicks)}
              hint="Previews de WhatsApp, Facebook etc., fora das contagens"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <Tabs defaultValue="sources">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                  <CardTitle className="text-base font-medium">
                    Fontes de tráfego
                  </CardTitle>
                  <TabsList>
                    <TabsTrigger value="sources">Fontes</TabsTrigger>
                    <TabsTrigger value="pages">Páginas</TabsTrigger>
                  </TabsList>
                </CardHeader>
                <CardContent>
                  <TabsContent value="sources" className="mt-0">
                    <TrafficList
                      rows={report.sources}
                      icon="source"
                      emptyText="Nenhum clique no período."
                    />
                  </TabsContent>
                  <TabsContent value="pages" className="mt-0">
                    <TrafficList
                      rows={report.pages}
                      emptyText="Nenhuma página de destino registrada no período."
                    />
                  </TabsContent>
                </CardContent>
              </Tabs>
            </Card>

            <Card>
              <Tabs defaultValue="referrers">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                  <CardTitle className="text-base font-medium">
                    Origem declarada
                  </CardTitle>
                  <TabsList>
                    <TabsTrigger value="referrers">Referrers</TabsTrigger>
                    <TabsTrigger value="campaigns">UTM / src</TabsTrigger>
                  </TabsList>
                </CardHeader>
                <CardContent>
                  <TabsContent value="referrers" className="mt-0">
                    <TrafficList
                      rows={report.referrers}
                      icon="referrer"
                      emptyText="Nenhum clique trouxe Referer no período — apps de mensagem não mandam."
                    />
                  </TabsContent>
                  <TabsContent value="campaigns" className="mt-0">
                    <TrafficList
                      rows={report.campaigns}
                      emptyText="Nenhum link com ?src= ou utm_* no período. Divulgue links como ?ref=CODIGO&src=whatsapp para medir o canal."
                    />
                  </TabsContent>
                </CardContent>
              </Tabs>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <Tabs defaultValue="devices">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                  <CardTitle className="text-base font-medium">
                    Dispositivos
                  </CardTitle>
                  <TabsList>
                    <TabsTrigger value="devices">Tipo</TabsTrigger>
                    <TabsTrigger value="browsers">Navegadores</TabsTrigger>
                  </TabsList>
                </CardHeader>
                <CardContent>
                  <TabsContent value="devices" className="mt-0">
                    <TrafficList
                      rows={report.devices}
                      display="share"
                      emptyText="Sem dados no período."
                    />
                  </TabsContent>
                  <TabsContent value="browsers" className="mt-0">
                    <TrafficList
                      rows={report.browsers}
                      display="share"
                      emptyText="Sem dados no período."
                    />
                  </TabsContent>
                </CardContent>
              </Tabs>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base font-medium">
                  Sistemas operacionais
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TrafficList
                  rows={report.operatingSystems}
                  display="share"
                  emptyText="Sem dados no período."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="space-y-1 pb-4">
                <CardTitle className="text-base font-medium">
                  Robôs e previews
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Fetches automáticos (card de link no WhatsApp, crawler do
                  Facebook). Registrados, mas fora de toda contagem humana.
                </p>
              </CardHeader>
              <CardContent>
                <TrafficList
                  rows={report.bots}
                  icon="source"
                  emptyText="Nenhum robô detectado no período."
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
