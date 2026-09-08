"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import type { RecoveryPixOrderView } from "@/app/api/products/admin/recovery-pix/route";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatShortDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { ProductRecoveryPixDialog } from "./product-recovery-pix-dialog";

function money(amountCentavos: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCentavos / 100);
}

/** "vence em 3h" é o que o vendedor precisa saber; a data exata fica no title. */
function remainingLabel(expiresAt: string, now: number): string {
  const remainingMs = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "vencendo";
  const hours = Math.floor(remainingMs / 3_600_000);
  if (hours >= 1) return `vence em ${hours}h`;
  return `vence em ${Math.max(1, Math.round(remainingMs / 60_000))}min`;
}

/**
 * Fila de recuperação de vendas por Pix.
 *
 * Quem entra aqui gerou um Pix de infoproduto e deixou vencer — intenção de
 * compra declarada e não paga. O vendedor liga um por um no WhatsApp com um
 * código novo.
 */
export function RecoveryPixPanel() {
  const [orders, setOrders] = useState<RecoveryPixOrderView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<RecoveryPixOrderView | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/products/admin/recovery-pix", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Falha ao carregar a fila");
      setOrders((await response.json()) as RecoveryPixOrderView[]);
      setNow(Date.now());
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao carregar a fila",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // O "vence em Xh" envelhece na tela de quem deixa a aba aberta a manhã toda.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const pending = useMemo(
    () => orders.filter((order) => order.state === "expired").length,
    [orders],
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Pix vencido</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {isLoading
                ? "Carregando…"
                : orders.length === 0
                  ? "Ninguém deixou Pix vencer."
                  : `${pending} aguardando contato · ${orders.length - pending} com Pix no ar`}
            </p>
          </div>
          <Button
            disabled={isLoading}
            onClick={() => void load()}
            size="sm"
            type="button"
            variant="outline"
          >
            <RotateCw className="size-4" />
            Atualizar
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="min-w-[1080px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Produto</TableHead>
                <TableHead>Comprador</TableHead>
                <TableHead>Tentou em</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell className="h-28 text-center" colSpan={6}>
                    <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : orders.length === 0 ? (
                <TableRow>
                  <TableCell
                    className="h-28 text-center text-muted-foreground"
                    colSpan={6}
                  >
                    Nenhum Pix vencido no momento.
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">
                      {order.productTitle}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{order.buyerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {order.buyerEmail}
                        {order.buyerPhone ? ` · ${order.buyerPhone}` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatShortDateTimeInSaoPaulo(order.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                      {money(order.priceCentavos, order.currency)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {order.state === "active" && order.expiresAt ? (
                        <div className="space-y-1">
                          <Badge variant="secondary">
                            Pix ativo · {remainingLabel(order.expiresAt, now)}
                          </Badge>
                          <p
                            className="text-xs text-muted-foreground"
                            title={
                              order.generatedAt
                                ? formatShortDateTimeInSaoPaulo(order.generatedAt)
                                : undefined
                            }
                          >
                            {order.adminEmail ?? "admin"}
                            {order.attempts > 1 ? ` · ${order.attempts}ª tentativa` : ""}
                          </p>
                        </div>
                      ) : (
                        <Badge variant="destructive">Vencido</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        onClick={() => setSelected(order)}
                        size="sm"
                        type="button"
                        variant={order.state === "active" ? "outline" : "default"}
                      >
                        {order.state === "active" ? "Ver Pix" : "Gerar Pix"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ProductRecoveryPixDialog
        onGenerated={() => void load()}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        order={selected}
      />
    </>
  );
}
