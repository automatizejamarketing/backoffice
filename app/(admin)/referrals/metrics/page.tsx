"use client";

// Métricas e alertas do programa de afiliados v2 (ticket 14).
//
// A tela que diz ao operador se o programa está dando lucro e se algo quebrou
// em silêncio. Três escolhas de apresentação carregam a decisão:
//
//   * **A margem líquida é uma coluna do MESMO ranking**, e não um relatório
//     separado. Quem olha "quem traz mais dinheiro" precisa ver, na mesma
//     linha, quanto esse dinheiro custou — é literalmente o caso que o ranking
//     por receita esconde.
//   * **Ordenar por margem coloca o pior primeiro.** Deliberado: o afiliado que
//     traz volume e dá prejuízo tem de aparecer no topo, não no fim de uma
//     lista longa.
//   * **Os alertas ficam ACIMA do ranking e só aparecem quando existem.** Uma
//     seção vazia permanente treina o operador a ignorar exatamente a seção que
//     um dia terá uma linha.
//
// Nenhum alerta tem botão de "marcar como lido": os dois somem sozinhos quando
// a causa é resolvida (o reconciliador liquida o evento; o gateway completa o
// estorno). Um alerta que precisa ser dispensado à mão acaba dispensado sem ser
// resolvido.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  formatEpc,
  formatShare,
  REFERRAL_COMMISSION_STATUS_LABELS,
  REFERRAL_METRIC_SORT_LABELS,
  REFERRAL_METRIC_SORT_VALUES,
  type ReferralMetricSort,
  type ReferralProgramMetrics,
} from "@/lib/referral/metrics";
import { formatCentavos } from "@/lib/referral/write-off";
import type { ReferralCommissionStatus } from "@/lib/db/schema";

const money = formatCentavos;

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

/** Um número grande com uma explicação curta embaixo. */
function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "negative";
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={`mt-1 text-2xl font-semibold tabular-nums ${
            tone === "negative" ? "text-destructive" : ""
          }`}
        >
          {value}
        </p>
        {hint && (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

const COMMISSION_STATUS_ORDER: ReferralCommissionStatus[] = [
  "foreseen",
  "approved",
  "paid",
  "reversed",
  "rejected",
];

export default function ReferralMetricsPage() {
  const [metrics, setMetrics] = useState<ReferralProgramMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<ReferralMetricSort>("net_revenue");

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/referrals/metrics?sort=${sort}`);
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || "Erro ao carregar as métricas");
        return;
      }
      setMetrics(data);
    } catch {
      toast.error("Erro ao carregar as métricas");
    } finally {
      setLoading(false);
    }
  }, [sort]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const stuck = metrics?.alerts.stuckSettlements ?? [];
  const partials = metrics?.alerts.partialReversals ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Métricas do programa (v2)
          </h1>
          <p className="text-sm text-muted-foreground">
            Margem líquida por afiliado é o número que decide: o ranking por
            receita, sozinho, esconde quem traz volume e dá prejuízo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/referrals">Fila de afiliação</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/referrals/traffic">Tráfego</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/referrals/payouts">Saques</Link>
          </Button>
        </div>
      </div>

      {loading && !metrics ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !metrics ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Não foi possível carregar as métricas.
        </p>
      ) : (
        <>
          {/*
            Alertas primeiro. Uma falha silenciosa que aparece embaixo de seis
            cartões de número é uma falha silenciosa com passos extras.
          */}
          {stuck.length > 0 && (
            <Card className="border-destructive/40">
              <CardHeader className="space-y-1 pb-4">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                  <Clock className="h-4 w-4 text-destructive" />
                  Eventos presos em aguardando liquidação
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Sem líquido não há comissão. Um evento cujo líquido nunca
                  chega vira comissão silenciosamente não paga — o afiliado
                  nunca saberá que ela existiu. Estes estão parados há mais de{" "}
                  {metrics.alerts.stuckSettlementDays} dias; o alerta some
                  sozinho quando o reconciliador completa o líquido.
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Afiliado</TableHead>
                      <TableHead>Indicado</TableHead>
                      <TableHead>Gateway</TableHead>
                      <TableHead className="text-right">Bruto</TableHead>
                      <TableHead className="text-right">Parado há</TableHead>
                      <TableHead>Evento</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stuck.map((row) => (
                      <TableRow key={row.eventId}>
                        <TableCell>
                          <code className="text-xs">{row.affiliateCode}</code>
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.customerName || "Indicado sem nome"}
                        </TableCell>
                        <TableCell className="text-sm capitalize">
                          {row.provider}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {money(row.grossCentavos)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-destructive">
                          {row.daysStuck} dias
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <p>{formatDate(row.occurredAt)}</p>
                          <code className="text-[10px]">{row.eventKey}</code>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {partials.length > 0 && (
            <Card className="border-destructive/40">
              <CardHeader className="space-y-1 pb-4">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Estornos parciais
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  A política é de estorno sempre total, então um parcial
                  significa que alguém errou no painel do gateway ou que
                  apareceu um crédito de proration. A comissão já foi revertida
                  integralmente; o que falta é conferir o valor no gateway. O
                  alerta some quando o estorno é completado. Sem afiliado na
                  linha, a venda não era de um Indicado — a anomalia é do
                  pagamento, não da comissão.
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Afiliado</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Gateway</TableHead>
                      <TableHead className="text-right">Valor pago</TableHead>
                      <TableHead className="text-right">
                        Valor estornado
                      </TableHead>
                      <TableHead className="text-right">Faltam</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {partials.map((row) => (
                      <TableRow key={row.paymentId}>
                        <TableCell>
                          {row.affiliateCode ? (
                            <code className="text-xs">{row.affiliateCode}</code>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              não é indicado
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.userEmail}
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className="capitalize">{row.provider}</span>
                          <Badge variant="outline" className="ml-2">
                            {row.reversalKind === "chargeback"
                              ? "Chargeback"
                              : "Estorno"}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {money(row.paidCentavos)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {money(row.refundedCentavos)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-destructive">
                          {money(row.gapCentavos)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(row.refundedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Receita líquida gerada"
              value={money(metrics.totals.netRevenueCentavos)}
              hint={`Bruto ${money(metrics.totals.grossRevenueCentavos)} · ${metrics.totals.commissionedInvoices} faturas comissionadas`}
            />
            <Stat
              label="Comissão gerada"
              value={money(metrics.totals.commissionGeneratedCentavos)}
              hint={`Já paga: ${money(metrics.totals.commissionPaidCentavos)}`}
            />
            <Stat
              label="Margem líquida"
              value={money(metrics.totals.marginCentavos)}
              tone={
                metrics.totals.marginCentavos < 0 ? "negative" : undefined
              }
              hint="Receita líquida menos comissão gerada — o que ainda não foi pago já é passivo certo"
            />
            <Stat
              label="Passivo de Comissão"
              value={money(metrics.liability.totalCentavos)}
              hint={`Gerado e ainda não pago, em ${metrics.liability.affiliatesOwedCount} afiliados — não é projeção de futuro`}
            />
            <Stat
              label="EPC do programa"
              value={formatEpc(metrics.totals.epcCentavos)}
              hint={`${metrics.totals.clicks} cliques · ${metrics.totals.customers} indicados`}
            />
            <Stat
              label="Concentração do top 10%"
              value={formatShare(metrics.concentration.share)}
              hint={`${metrics.concentration.topCount} de ${metrics.concentration.affiliateCount} afiliados respondem por essa fatia da receita líquida`}
            />
            <Stat
              label="Em carência"
              value={money(metrics.liability.inGraceCentavos)}
              hint="Parte do passivo que o afiliado ainda nem pode pedir"
            />
            <Stat
              label="Retido em saques abertos"
              value={money(metrics.liability.heldInOpenPayoutsCentavos)}
              hint={`Pronto para pedir: ${money(metrics.liability.readyToRequestCentavos)}`}
            />
          </div>

          <Card>
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-base font-medium">
                Comissões pelos cinco estados
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                O pipeline do programa. Revertida e recusada aparecem mas não
                entram na comissão gerada — a primeira foi desfeita por estorno,
                a segunda nunca chegou a valer.
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Comissões</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {COMMISSION_STATUS_ORDER.map((status) => (
                    <TableRow key={status}>
                      <TableCell>
                        {REFERRAL_COMMISSION_STATUS_LABELS[status]}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {metrics.commissionsByStatus[status].count}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {money(metrics.commissionsByStatus[status].amountCentavos)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-base font-medium">
                Ranking de afiliados
              </CardTitle>
              <Select
                value={sort}
                onValueChange={(value) =>
                  setSort(value as ReferralMetricSort)
                }
              >
                <SelectTrigger className="w-[260px]">
                  <SelectValue placeholder="Ordenar por" />
                </SelectTrigger>
                <SelectContent>
                  {REFERRAL_METRIC_SORT_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {REFERRAL_METRIC_SORT_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {metrics.affiliates.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum afiliado aprovado ainda
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Afiliado</TableHead>
                      <TableHead className="text-right">Cliques</TableHead>
                      <TableHead className="text-right">Indicados</TableHead>
                      <TableHead className="text-right">Faturas</TableHead>
                      <TableHead className="text-right">
                        Receita líquida
                      </TableHead>
                      <TableHead className="text-right">
                        Comissão gerada
                      </TableHead>
                      <TableHead className="text-right">
                        Comissão paga
                      </TableHead>
                      <TableHead className="text-right">Passivo</TableHead>
                      <TableHead className="text-right">Margem</TableHead>
                      <TableHead className="text-right">EPC</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metrics.affiliates.map((row) => (
                      <TableRow key={row.affiliateId}>
                        <TableCell>
                          <p className="font-medium">{row.user.name || "—"}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.user.email}
                          </p>
                          <code className="text-xs text-muted-foreground">
                            {row.affiliateCode}
                          </code>
                          {row.affiliateStatus === "blocked" && (
                            <Badge variant="secondary" className="ml-2">
                              Bloqueado
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.clicks}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.customers}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.commissionedInvoices}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {money(row.netRevenueCentavos)}
                          {row.reversedNetRevenueCentavos > 0 && (
                            <p className="text-xs text-muted-foreground">
                              estornado {money(row.reversedNetRevenueCentavos)}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {money(row.commissionGeneratedCentavos)}
                          {row.commissionReversedCentavos > 0 && (
                            <p className="text-xs text-muted-foreground">
                              revertida {money(row.commissionReversedCentavos)}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {money(row.commissionPaidCentavos)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                          {money(row.liabilityCentavos)}
                        </TableCell>
                        <TableCell
                          className={`whitespace-nowrap text-right font-medium tabular-nums ${
                            row.marginCentavos < 0 ? "text-destructive" : ""
                          }`}
                        >
                          {money(row.marginCentavos)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                          {formatEpc(row.epcCentavos)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
