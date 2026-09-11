"use client";
import type { ReactNode } from "react";
import {
  Check,
  Clock3,
  Info,
  Pause,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone =
  | "success"
  | "warning"
  | "danger"
  | "neutral"
  | "info"
  | "violet"
  | "orange";

const tones: Record<
  StatusTone,
  { icon: LucideIcon; className: string; surfaceClassName: string }
> = {
  success: {
    icon: Check,
    className: "text-success",
    surfaceClassName: "border-success/40 bg-success/15",
  },
  warning: {
    icon: Clock3,
    className: "text-warning",
    surfaceClassName: "border-warning/40 bg-warning/15",
  },
  danger: {
    icon: TriangleAlert,
    className: "text-destructive",
    surfaceClassName: "border-destructive/40 bg-destructive/15",
  },
  neutral: {
    icon: Pause,
    className: "text-muted-foreground",
    surfaceClassName: "border-border bg-muted/40",
  },
  info: {
    icon: Info,
    className: "text-info",
    surfaceClassName: "border-info/40 bg-info/15",
  },
  violet: {
    icon: Sparkles,
    className: "text-violet",
    surfaceClassName: "border-violet/40 bg-violet/15",
  },
  orange: {
    icon: RefreshCw,
    className: "text-orange",
    surfaceClassName: "border-orange/40 bg-orange/15",
  },
};

/** Classe de cor do tom, para pontos e textos fora do badge. */
export function statusToneClassName(tone: StatusTone): string {
  return tones[tone].className;
}

/** Fundo e borda tingidos pelo tom, para colunas de kanban e blocos de estado. */
export function statusToneSurfaceClassName(tone: StatusTone): string {
  return tones[tone].surfaceClassName;
}

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
