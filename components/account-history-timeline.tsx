import {
  CalendarClock,
  CreditCard,
  History,
  MailCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";
import type { SerializedAccountHistoryItem } from "@/lib/backoffice/account-history";
import { formatDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { cn } from "@/lib/utils";

function HistoryIcon({ kind }: { kind: SerializedAccountHistoryItem["kind"] }) {
  switch (kind) {
    case "created":
      return <UserPlus className="size-3.5" />;
    case "trial":
      return <Sparkles className="size-3.5" />;
    case "email_verified":
      return <MailCheck className="size-3.5" />;
    case "payment":
      return <CreditCard className="size-3.5" />;
    case "admin_expiration":
      return <CalendarClock className="size-3.5" />;
    case "subscription_event":
      return <History className="size-3.5" />;
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

export function AccountHistoryTimeline({
  items,
  isLoading = false,
}: {
  items: SerializedAccountHistoryItem[];
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Carregando histórico…</p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum evento de conta ou assinatura ainda.
      </p>
    );
  }

  return (
    <ol className="space-y-0">
      {items.map((item, index) => (
        <li key={item.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={cn(
                "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground",
                item.kind === "admin_expiration" &&
                  "border-primary/30 text-primary",
                item.kind === "payment" && "border-emerald-500/30 text-emerald-600",
              )}
            >
              <HistoryIcon kind={item.kind} />
            </span>
            {index < items.length - 1 ? (
              <span className="w-px flex-1 bg-border" />
            ) : null}
          </div>
          <div className="min-w-0 pb-5">
            <p className="text-sm font-medium leading-snug">{item.title}</p>
            {item.detail ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {item.detail}
              </p>
            ) : null}
            <p className="mt-1 text-[11px] text-muted-foreground">
              {formatDateTimeInSaoPaulo(item.at)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
