"use client";

import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { formatBrazilianPhone, getWhatsAppUrl } from "@/lib/phone";

export function OrderBuyerWhatsApp({
  phone,
}: {
  phone: string | null | undefined;
}) {
  const phoneFormatted = formatBrazilianPhone(phone);
  const whatsappUrl = getWhatsAppUrl(phone);

  if (!phoneFormatted) {
    return <span className="text-sm text-muted-foreground">Sem WhatsApp</span>;
  }

  if (!whatsappUrl) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-foreground/80">
        <WhatsAppIcon muted className="size-3.5" />
        {phoneFormatted}
      </span>
    );
  }

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-foreground/80 hover:text-[#25D366] hover:underline"
      aria-label={`Abrir conversa no WhatsApp com ${phoneFormatted}`}
      onClick={(event) => event.stopPropagation()}
    >
      <WhatsAppIcon className="size-3.5" />
      {phoneFormatted}
    </a>
  );
}
