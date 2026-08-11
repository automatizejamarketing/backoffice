import { Badge } from "@/components/ui/badge";
import type { WhatsappClickKind } from "@/lib/backoffice/whatsapp-history-model";
import { formatShortDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";

const CLICK_KIND_LABELS: Record<WhatsappClickKind, string> = {
  url: "Link",
  quick_reply: "Resposta rápida",
};

export function WhatsappClickInfo({
  clickedAt,
  clickKind,
}: {
  clickedAt: Date | null;
  clickKind: WhatsappClickKind | null;
}) {
  if (!clickedAt) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Badge variant="outline">
        {clickKind ? CLICK_KIND_LABELS[clickKind] : "Clicado"}
      </Badge>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {formatShortDateTimeInSaoPaulo(clickedAt)}
      </span>
    </div>
  );
}
