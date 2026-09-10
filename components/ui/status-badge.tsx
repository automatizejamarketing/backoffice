"use client";
import type { ReactNode } from "react";
import { Check, Clock3, Pause, TriangleAlert, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "neutral";

const tones: Record<StatusTone, { icon: LucideIcon; className: string }> = {
  success: { icon: Check, className: "text-success" },
  warning: { icon: Clock3, className: "text-warning" },
  danger: { icon: TriangleAlert, className: "text-destructive" },
  neutral: { icon: Pause, className: "text-muted-foreground" },
};

export type StatusBadgeProps = {
  tone: StatusTone;
  /** Troca o ícone padrão do tom. Sempre há um ícone: a largura não muda entre estados. */
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
};

/** Estado com cor no texto e ícone, independente da cor de marca. */
export function StatusBadge({ tone, icon, className, children }: StatusBadgeProps) {
  const Icon = icon ?? tones[tone].icon;
  return (
    <Badge variant="outline" className={cn(tones[tone].className, className)}>
      <Icon data-icon="inline-start" />
      {children}
    </Badge>
  );
}
