"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getWhatsappTemplateCatalogEntry,
  getWhatsappTemplateLabel,
  WHATSAPP_TEMPLATE_PREVIEW_URLS,
} from "@/lib/backoffice/whatsapp-template-catalog";

function WhatsappTemplatePreview({
  templateName,
}: {
  templateName: string;
}) {
  const entry = getWhatsappTemplateCatalogEntry(templateName);
  if (!entry) {
    return (
      <p className="text-sm text-muted-foreground">
        Preview não disponível para este template.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {entry.preview.map((part, index) => {
        if (part.type === "body") {
          return (
            <div
              key={`body-${index}`}
              className="rounded-lg rounded-tl-sm bg-emerald-950/40 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-foreground ring-1 ring-emerald-900/30"
            >
              {part.text}
            </div>
          );
        }

        return (
          <div
            key={`button-${index}`}
            className="inline-flex rounded-md bg-background px-3 py-2 text-sm font-medium text-sky-400 ring-1 ring-border"
          >
            {part.text}
          </div>
        );
      })}
      {WHATSAPP_TEMPLATE_PREVIEW_URLS[templateName]?.map((url) => (
        <p
          key={url}
          className="truncate font-mono text-[11px] text-muted-foreground"
        >
          {url}
        </p>
      ))}
    </div>
  );
}

export function WhatsappTemplateInfo({
  templateName,
}: {
  templateName: string;
}) {
  const [open, setOpen] = useState(false);
  const entry = getWhatsappTemplateCatalogEntry(templateName);
  const label = getWhatsappTemplateLabel(templateName);

  return (
    <>
      <TooltipProvider delayDuration={200}>
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-sm text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {label}
            </button>
            {entry ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="inline-flex shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Regra de disparo: ${label}`}
                  >
                    <Info className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-sm text-left">
                  {entry.businessRule}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {templateName}
          </p>
        </div>
      </TooltipProvider>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {templateName}
            </DialogDescription>
          </DialogHeader>
          {entry ? (
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Regra de disparo
                </p>
                <p className="text-sm leading-relaxed text-foreground">
                  {entry.businessRule}
                </p>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Conteúdo do template
                </p>
                <WhatsappTemplatePreview templateName={templateName} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Template sem catálogo local. ID: {templateName}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
