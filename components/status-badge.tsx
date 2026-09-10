import { Check, Clock3, Minus, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StatusBadgeProps } from "@/lib/subscriptions/derive";

// Same recipe as the design system's status-badge: outline badge, a leading
// icon and a semantic text color. Destructive keeps its tinted variant so an
// expired state stands out in a list.
const TONE_STYLES = {
  success: { icon: Check, className: "text-success" },
  warning: { icon: Clock3, className: "text-warning" },
  destructive: { icon: TriangleAlert, className: "" },
  neutral: { icon: Minus, className: "text-muted-foreground" },
} as const;

export function StatusBadge({
  badge,
  className,
}: {
  badge: StatusBadgeProps;
  className?: string;
}) {
  const { icon: Icon, className: toneClass } = TONE_STYLES[badge.tone];
  return (
    <Badge
      variant={badge.tone === "destructive" ? "destructive" : "outline"}
      className={cn("w-fit", toneClass, className)}
    >
      <Icon data-icon="inline-start" aria-hidden="true" />
      {badge.label}
    </Badge>
  );
}

export function StatusBadgeWithHint({
  badge,
  className,
}: {
  badge: StatusBadgeProps;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <StatusBadge badge={badge} />
      {badge.hint ? (
        <span className="text-[11px] text-muted-foreground">{badge.hint}</span>
      ) : null}
    </div>
  );
}
