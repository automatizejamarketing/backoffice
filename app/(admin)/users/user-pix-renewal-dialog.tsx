"use client";

import { useEffect, useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import type { PixLinkView } from "@/components/mercadopago-pix-actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PlanType } from "@/lib/db/schema";
import { PLAN_DEFINITIONS, PLAN_TYPES } from "@/lib/stripe/plans";
import { formatShortDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";

function formatMoney(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
}

function formatDateTime(value: string): string {
  return formatShortDateTimeInSaoPaulo(value);
}

function buildPixWhatsAppMessage(link: PixLinkView): string {
  const planName = PLAN_DEFINITIONS[link.planType].name;
  const amount = formatMoney(link.amount, link.currency);
  const expiresAt = formatDateTime(link.expiresAt);
  const code = link.pixCopyPasteCode ?? "";

  return [
    `Olá! Segue o Pix para renovar seu plano ${planName} (${amount}):`,
    "",
    code,
    "",
    `Válido até ${expiresAt}.`,
  ].join("\n");
}

export function UserPixRenewalDialog({
  open,
  onOpenChange,
  userId,
  userEmail,
  userPhone,
  currentPlanType,
  disabledReason,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userEmail: string;
  userPhone?: string | null;
  currentPlanType?: PlanType | null;
  disabledReason?: string | null;
}) {
  const [planType, setPlanType] = useState<PlanType>(
    currentPlanType ?? "monthly_pro",
  );
  const [link, setLink] = useState<PixLinkView | null>(null);
  const [reused, setReused] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setLink(null);
      setReused(false);
      setErrorMessage(null);
      setPlanType(currentPlanType ?? "monthly_pro");
      return;
    }
    setPlanType(currentPlanType ?? "monthly_pro");
  }, [open, currentPlanType]);

  async function generatePix() {
    setIsGenerating(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/users/${userId}/mercadopago-pix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planType, sendEmail: false }),
      });
      const json = (await response.json()) as {
        link?: PixLinkView;
        reused?: boolean;
        error?: string;
      };

      if (!response.ok || !json.link?.pixCopyPasteCode) {
        throw new Error(json.error ?? "Falha ao gerar Pix");
      }

      setLink(json.link);
      setReused(json.reused === true);
      toast.success(json.reused ? "Pix reutilizado" : "Pix gerado");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível gerar o Pix";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyPixCode() {
    if (!link?.pixCopyPasteCode) return;
    try {
      await navigator.clipboard.writeText(link.pixCopyPasteCode);
      toast.success("Código Pix copiado");
    } catch {
      toast.error("Não foi possível copiar. Selecione o código manualmente.");
    }
  }

  const whatsappUrl =
    link && userPhone
      ? getWhatsAppUrl(userPhone, buildPixWhatsAppMessage(link))
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pix para renovação</DialogTitle>
          <DialogDescription>
            Gere um Pix único para {userEmail}. O cliente paga escaneando o QR
            ou colando o código no app do banco.
          </DialogDescription>
        </DialogHeader>

        {disabledReason ? (
          <p className="text-sm text-muted-foreground">{disabledReason}</p>
        ) : errorMessage ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </p>
        ) : link?.pixCopyPasteCode ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-lg border bg-white p-4">
              <QRCode value={link.pixCopyPasteCode} size={192} />
              <p className="text-center text-xs text-muted-foreground">
                Escaneie ou copie o código Pix abaixo
              </p>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {PLAN_DEFINITIONS[link.planType].name}
                </span>
                <Badge variant="secondary">{link.status}</Badge>
                {reused ? <Badge variant="outline">Reutilizado</Badge> : null}
              </div>
              <p className="text-muted-foreground">
                {formatMoney(link.amount, link.currency)} · vence{" "}
                {formatDateTime(link.expiresAt)}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">
                Pix copia e cola
              </p>
              <textarea
                readOnly
                value={link.pixCopyPasteCode}
                onFocus={(event) => event.currentTarget.select()}
                className="min-h-24 w-full resize-none rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs"
                aria-label="Código Pix copia e cola"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Select
              value={planType}
              onValueChange={(value) => setPlanType(value as PlanType)}
              disabled={isGenerating}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLAN_TYPES.map((plan) => (
                  <SelectItem key={plan} value={plan}>
                    {PLAN_DEFINITIONS[plan].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:gap-0">
          {link?.pixCopyPasteCode ? (
            <>
              {whatsappUrl ? (
                <Button
                  type="button"
                  asChild
                  className="bg-[#25D366] hover:bg-[#20bd5a]"
                >
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <WhatsAppIcon className="size-4 text-white" />
                    Enviar no WhatsApp
                  </a>
                </Button>
              ) : null}
              <Button type="button" onClick={() => void copyPixCode()}>
                <Copy className="size-4" />
                Copiar código Pix
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isGenerating}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => void generatePix()}
                disabled={!!disabledReason || isGenerating}
              >
                {isGenerating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Gerar Pix
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
