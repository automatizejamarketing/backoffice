"use client";

import type { ReactNode } from "react";
import { ExternalLink, MessageCircle, RotateCw } from "lucide-react";
import { pageWhatsappSettingsUrl } from "@/lib/meta-business/marketing/page-whatsapp-number";
import { cn } from "@/lib/utils";
import { usePageWhatsappNumber } from "../hooks/use-page-whatsapp-number";

type WhatsappDestinationCardProps = {
  pageId: string | null;
  pageName?: string | null;
  accountId?: string | null;
  userId?: string | null;
  enabled: boolean;
  title?: string;
  className?: string;
  children?: ReactNode;
};

/**
 * Where a click-to-WhatsApp ad leads. Local to the backoffice — the frontend
 * has its own card so the two UIs never share a TSX file.
 */
export function WhatsappDestinationCard({
  pageId,
  pageName,
  accountId,
  userId,
  enabled,
  title,
  className,
  children,
}: WhatsappDestinationCardProps) {
  const whatsappNumber = usePageWhatsappNumber(
    pageId,
    enabled,
    accountId,
    userId,
  );
  const resolved =
    whatsappNumber.state.phase === "resolved"
      ? whatsappNumber.state.data
      : null;
  const fallbackUrl = pageId ? pageWhatsappSettingsUrl(pageId) : null;
  const settingsUrl = resolved?.settingsUrl ?? fallbackUrl;
  const addUrl = resolved?.addUrl ?? fallbackUrl;
  const editUrl = resolved?.editUrl ?? fallbackUrl;
  const pageLabel = pageName ?? "a Página";

  const headline =
    resolved?.status === "linked"
      ? `O anúncio abre o WhatsApp ${resolved.number}`
      : `O WhatsApp vinculado à Página ${pageLabel}`;

  const hint =
    resolved?.status === "not_linked"
      ? "Esta Página não tem nenhum número de WhatsApp vinculado. Adicione um na Meta antes de publicar."
      : resolved?.status === "linked"
        ? "Quem clicar no anúncio abre uma conversa com esse número. Se quiser usar outro, troque na Meta."
        : "A Meta resolve o número pela Página. Confira ou adicione o WhatsApp nas configurações da Página.";

  const primaryHref =
    resolved?.status === "not_linked" ? addUrl : (editUrl ?? settingsUrl);
  const primaryLabel =
    resolved?.status === "not_linked"
      ? "Adicionar número na Meta"
      : "Trocar o número na Meta";

  return (
    <div className={className}>
      {title ? <h2 className="text-sm font-semibold">{title}</h2> : null}

      <div className="mt-3 flex items-start gap-2.5 rounded-md border border-input bg-muted/40 px-3 py-2.5">
        <MessageCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-foreground">{headline}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        {primaryHref ? (
          <a
            href={primaryHref}
            target="_blank"
            rel="noreferrer noopener"
            className={cn(
              "inline-flex items-center gap-1.5 text-xs leading-relaxed text-muted-foreground underline underline-offset-2 hover:text-foreground",
            )}
          >
            <ExternalLink className="size-3.5" />
            {primaryLabel}
          </a>
        ) : null}

        {whatsappNumber.state.phase === "failed" && (
          <button
            type="button"
            onClick={whatsappNumber.reload}
            className="inline-flex items-center gap-1.5 text-xs leading-relaxed text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            <RotateCw className="size-3.5" />
            Tentar carregar de novo
          </button>
        )}
      </div>

      {children}
    </div>
  );
}
