import { Check, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  WHATSAPP_STATUS_LABELS,
  type WhatsappDeliveryStatus,
} from "@/lib/backoffice/whatsapp-history-model";
import { cn } from "@/lib/utils";

type WhatsappDeliveryStatusProps = {
  status: WhatsappDeliveryStatus;
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  historicalStatusUntracked?: boolean;
  compact?: boolean;
};

const STATUS_PROGRESS: Partial<Record<WhatsappDeliveryStatus, number>> = {
  sent: 1,
  delivered: 2,
  read: 3,
};

export function WhatsappDeliveryStatus({
  status,
  acceptedAt,
  deliveredAt,
  readAt,
  historicalStatusUntracked = false,
  compact = false,
}: WhatsappDeliveryStatusProps) {
  if (status === "failed") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="destructive">Falhou</Badge>
        {historicalStatusUntracked && <HistoricalBadge />}
      </div>
    );
  }

  if (status === "queued" || status === "deleted") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status === "queued" ? "secondary" : "outline"}>
          {WHATSAPP_STATUS_LABELS[status]}
        </Badge>
        {historicalStatusUntracked && <HistoricalBadge />}
      </div>
    );
  }

  const progress = Math.max(
    STATUS_PROGRESS[status] ?? 0,
    acceptedAt ? 1 : 0,
    deliveredAt ? 2 : 0,
    readAt ? 3 : 0,
  );
  const steps = ["Enviado", "Entregue", "Lido"];

  return (
    <div className="space-y-1.5" aria-label={`Status: ${WHATSAPP_STATUS_LABELS[status]}`}>
      <div className={cn("flex items-center", compact ? "min-w-52" : "min-w-64")}>
        {steps.map((label, index) => {
          const reached = progress >= index + 1;
          return (
            <div
              key={label}
              className={cn(
                "flex items-center",
                index < steps.length - 1 && "flex-1",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border",
                  reached
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-muted-foreground/30 text-muted-foreground/50",
                )}
              >
                {reached ? (
                  <Check className="size-3" aria-hidden="true" />
                ) : (
                  <Circle className="size-2 fill-current" aria-hidden="true" />
                )}
              </span>
              {index < steps.length - 1 && (
                <span
                  className={cn(
                    "mx-1 h-px flex-1",
                    progress > index + 1
                      ? "bg-emerald-600"
                      : "bg-border",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
      <div
        className={cn(
          "grid text-[10px] leading-none text-muted-foreground",
          compact ? "min-w-52 grid-cols-3" : "min-w-64 grid-cols-3",
        )}
      >
        {steps.map((label, index) => (
          <span
            key={label}
            className={cn(
              index === 1 && "text-center",
              index === 2 && "text-right",
              progress >= index + 1 && "font-medium text-foreground",
            )}
          >
            {label}
          </span>
        ))}
      </div>
      {historicalStatusUntracked && <HistoricalBadge />}
    </div>
  );
}

function HistoricalBadge() {
  return (
    <Badge variant="outline" className="text-[10px] font-normal">
      Status posterior não rastreado
    </Badge>
  );
}
