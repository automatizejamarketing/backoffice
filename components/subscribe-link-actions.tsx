"use client";

import { useState } from "react";
import { Copy, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatShortDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { getWhatsAppUrl } from "@/lib/phone";

type SubscribeLink = {
  url: string;
  expiresAt: string;
  reused: boolean;
};

function buildSubscribeLinkWhatsAppMessage(link: SubscribeLink): string {
  return [
    "Olá! Segue o link para escolher seu plano e ativar seu acesso na Automatize:",
    "",
    link.url,
    "",
    `Válido até ${formatShortDateTimeInSaoPaulo(link.expiresAt)}.`,
  ].join("\n");
}

/**
 * Gerador do link público de assinatura (`/pagar/<token>` no frontend).
 * O link vale 7 dias, é reutilizável até o pagamento e fica bloqueado para
 * quem está com plano ativo — a disponibilidade vem de
 * `getSubscribeLinkDisabledReason`, passada via `disabledReason`.
 */
export function SubscribeLinkActions({
  userId,
  userEmail,
  userPhone,
  disabledReason,
}: {
  userId: string;
  userEmail: string;
  userPhone?: string | null;
  disabledReason?: string | null;
}) {
  const [link, setLink] = useState<SubscribeLink | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function generateLink() {
    setIsGenerating(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/users/${userId}/subscribe-link`, {
        method: "POST",
      });
      const json = (await response.json()) as {
        subscribeUrl?: string;
        expiresAt?: string;
        reused?: boolean;
        error?: string;
        reason?: string;
      };
      if (!response.ok || !json.subscribeUrl || !json.expiresAt) {
        throw new Error(
          json.reason ?? json.error ?? "Não foi possível gerar o link",
        );
      }
      setLink({
        url: json.subscribeUrl,
        expiresAt: json.expiresAt,
        reused: json.reused === true,
      });
      toast.success(json.reused ? "Link reutilizado" : "Link gerado");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível gerar o link de assinatura";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success("Link de assinatura copiado");
    } catch {
      toast.error("Não foi possível copiar. Selecione o link manualmente.");
    }
  }

  const whatsAppUrl = link
    ? getWhatsAppUrl(userPhone, buildSubscribeLinkWhatsAppMessage(link))
    : null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Página pública em que {userEmail} escolhe o plano e paga pela Vindi —
        sem precisar de login. Vale 7 dias e deixa de funcionar assim que o
        plano estiver ativo.
      </p>

      {disabledReason ? (
        <p className="text-sm text-muted-foreground">{disabledReason}</p>
      ) : (
        <Button
          type="button"
          disabled={isGenerating}
          onClick={() => void generateLink()}
        >
          {isGenerating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Link2 className="size-4" />
          )}
          {link ? "Gerar de novo" : "Gerar link de assinatura"}
        </Button>
      )}

      {errorMessage ? (
        <p className="text-sm text-destructive">{errorMessage}</p>
      ) : null}

      {link ? (
        <div className="space-y-2">
          <Input
            readOnly
            value={link.url}
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono text-xs"
            aria-label="Link de assinatura"
          />
          <p className="text-xs text-muted-foreground">
            Válido até {formatShortDateTimeInSaoPaulo(link.expiresAt)}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void copyLink()}>
              <Copy className="size-4" />
              Copiar link
            </Button>
            {whatsAppUrl ? (
              <Button asChild type="button" variant="outline">
                <a href={whatsAppUrl} rel="noopener noreferrer" target="_blank">
                  <WhatsAppIcon className="size-4" />
                  Enviar no WhatsApp
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
