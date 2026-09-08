"use client";

import { useEffect, useState } from "react";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import type { RecoveryPixOrderView } from "@/app/api/products/admin/recovery-pix/route";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { getWhatsAppUrl } from "@/lib/phone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatShortDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";

export type GeneratedRecoveryPix = {
  orderId: string;
  pixCopyPasteCode: string;
  amountCentavos: number;
  currency: string;
  expiresAt: string;
  generatedAt: string;
  adminEmail: string;
  attempts: number;
};

function money(amountCentavos: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCentavos / 100);
}

/**
 * Mensagem que o vendedor manda. O código vai sozinho numa linha de propósito:
 * o WhatsApp só oferece "copiar" em bloco contínuo, e um payload Pix picado por
 * texto em volta obriga o cliente a selecionar na mão.
 */
export function buildRecoveryWhatsAppMessage(
  order: RecoveryPixOrderView,
  pix: GeneratedRecoveryPix,
): string {
  return [
    `Oi, ${order.buyerName.split(" ")[0] ?? ""}! Aqui é da Automatize.`,
    `Vi que seu Pix de ${order.productTitle} venceu antes de você conseguir pagar.`,
    `Gerei um novo, de ${money(pix.amountCentavos, pix.currency)}:`,
    "",
    pix.pixCopyPasteCode,
    "",
    `É só copiar e colar no app do banco. Vale até ${formatShortDateTimeInSaoPaulo(pix.expiresAt)}.`,
    "Assim que o pagamento cair, seu acesso libera automaticamente e você recebe o e-mail com o link.",
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");
}

export function ProductRecoveryPixDialog({
  order,
  onOpenChange,
  onGenerated,
}: {
  order: RecoveryPixOrderView | null;
  onOpenChange: (open: boolean) => void;
  onGenerated: () => void;
}) {
  const [pix, setPix] = useState<GeneratedRecoveryPix | null>(null);
  const [reused, setReused] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (order) return;
    setPix(null);
    setReused(false);
    setErrorMessage(null);
  }, [order]);

  async function generate() {
    if (!order) return;
    setIsGenerating(true);
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/products/admin/orders/${order.id}/recovery-pix`,
        { method: "POST" },
      );
      const json = (await response.json()) as {
        pix?: GeneratedRecoveryPix;
        reused?: boolean;
        error?: string;
      };
      if (!response.ok || !json.pix?.pixCopyPasteCode) {
        throw new Error(json.error ?? "Falha ao gerar o Pix");
      }
      setPix(json.pix);
      setReused(json.reused === true);
      toast.success(json.reused ? "Pix ainda válido reaproveitado" : "Pix gerado");
      onGenerated();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Não foi possível gerar o Pix";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyCode() {
    if (!pix) return;
    try {
      await navigator.clipboard.writeText(pix.pixCopyPasteCode);
      toast.success("Código Pix copiado");
    } catch {
      toast.error("Não foi possível copiar. Selecione o código manualmente.");
    }
  }

  const whatsappUrl =
    order && pix
      ? getWhatsAppUrl(order.buyerPhone, buildRecoveryWhatsAppMessage(order, pix))
      : null;

  return (
    <Dialog open={Boolean(order)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pix de recuperação</DialogTitle>
          <DialogDescription>
            {order
              ? `${order.productTitle} · ${order.buyerEmail}. O acesso libera sozinho assim que o pagamento for identificado, junto com o e-mail de acesso — igual a uma compra pelo site.`
              : null}
          </DialogDescription>
        </DialogHeader>

        {errorMessage ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}

        {pix ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-lg border bg-white p-4">
              <QRCode size={192} value={pix.pixCopyPasteCode} />
              <p className="text-center text-xs text-muted-foreground">
                Escaneie ou copie o código abaixo
              </p>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {money(pix.amountCentavos, pix.currency)}
                </span>
                {reused ? <Badge variant="outline">Reaproveitado</Badge> : null}
                {pix.attempts > 1 ? (
                  <Badge variant="secondary">{pix.attempts}ª tentativa</Badge>
                ) : null}
              </div>
              <p className="text-muted-foreground">
                Vence {formatShortDateTimeInSaoPaulo(pix.expiresAt)}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">Pix copia e cola</p>
              <textarea
                readOnly
                value={pix.pixCopyPasteCode}
                onFocus={(event) => event.currentTarget.select()}
                className="min-h-24 w-full resize-none rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs"
                aria-label="Código Pix copia e cola"
              />
            </div>

            {order && !order.buyerPhone ? (
              <p className="text-xs text-muted-foreground">
                Este pedido não tem telefone salvo — copie o código e mande pelo
                canal que você já usa com o cliente.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {order?.state === "active"
              ? "Este pedido já tem um Pix no ar. Gerar aqui devolve o mesmo código, sem criar uma segunda cobrança."
              : "O Pix nasce pelo valor original do pedido e vale 24 horas."}
          </p>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:gap-0">
          {pix ? (
            <>
              {whatsappUrl ? (
                <Button asChild className="bg-[#25D366] hover:bg-[#20bd5a]" type="button">
                  <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                    <WhatsAppIcon className="size-4 text-white" />
                    Enviar no WhatsApp
                  </a>
                </Button>
              ) : null}
              <Button onClick={() => void copyCode()} type="button">
                <Copy className="size-4" />
                Copiar código Pix
              </Button>
            </>
          ) : (
            <Button disabled={isGenerating} onClick={() => void generate()} type="button">
              {isGenerating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {order?.state === "active" ? "Mostrar o Pix atual" : "Gerar Pix"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
