"use client";

import type { ComponentType, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Visual chrome for "Criar campanha com IA" in the backoffice.
 *
 * Same shape as the frontend's flow (one question per screen, a dot trail, a summary to approve)
 * on the backoffice's own tokens: Inter, `rounded-lg`, `ring-foreground/10` cards, shadcn
 * new-york buttons. No serif eyebrow, no italic accent, no motion library.
 */

/** Outer column of the flow page — one question at a time. */
export const flowPageShellClassName = "mx-auto w-full max-w-2xl px-4 pb-16 pt-2 sm:px-6";

/** A phase's outer <section>. */
export const flowSectionClassName = "mt-6 space-y-4 sm:mt-8 sm:space-y-5";

/** Card surface inside a phase — the backoffice Card look, without the Card's fixed padding. */
export const flowCardClassName = "rounded-lg bg-card p-4 ring-1 ring-foreground/10 sm:p-5";

/** Card surface that carries the AI accent (the mold banner, the "write with AI" box). */
export const flowAccentCardClassName =
  "rounded-lg border border-primary/20 bg-primary/5 p-4 sm:p-5";

/** Title of a card block. */
export const flowCardTitleClassName = "text-sm font-semibold leading-snug text-foreground";

/** Sentence under a card title. */
export const flowCardDescriptionClassName =
  "mt-1 text-xs leading-relaxed text-muted-foreground";

/** Running text. */
export const flowBodyClassName = "text-sm leading-relaxed text-foreground";

/** Emphasized inline label (page name, ad name). */
export const flowBodyMediumClassName = "text-sm font-medium leading-snug text-foreground";

/** Icon + one informational sentence. */
export const flowHintClassName =
  "flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground";

/** Advisory the operator may ignore. */
export const flowWarningClassName =
  "flex items-start gap-1.5 text-xs leading-relaxed text-amber-600 dark:text-amber-500";

/** Blocks progress until fixed. */
export const flowErrorClassName =
  "flex items-start gap-1.5 text-xs leading-relaxed text-destructive";

/** Review row label. */
export const flowRowLabelClassName =
  "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground";

/** Review row value. */
export const flowRowValueClassName = "text-sm text-foreground";

/** Mono metadata (ids). */
export const flowMonoCaptionClassName = "font-mono text-[11px] text-muted-foreground";

/** Review row divider. */
export const flowRowClassName =
  "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/60 pb-2.5 last:border-0 last:pb-0";

/** Selectable list item (proven ad, identity). */
export const flowSelectionItemClassName =
  "rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export const flowSelectionSelectedClassName = "border-primary bg-primary/5";
export const flowSelectionIdleClassName = "border-border hover:bg-muted/50";

/** Form field labels inside the flow. */
export const flowFieldLabelClassName = "text-sm font-medium text-foreground";

export const flowBackButtonClassName = "h-10 w-full sm:w-auto";
export const flowNextButtonClassName = "h-10 w-full sm:flex-1";

/** The page title, held across every phase. */
export function FlowHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header>
      <h1 className="text-2xl font-semibold leading-tight tracking-tight text-foreground">
        {title}
      </h1>
      <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
        {subtitle}
      </p>
    </header>
  );
}

/** Dot trail of the inbound steps the operator will actually see. */
export function FlowProgress({
  currentIndex,
  total,
  label,
}: {
  currentIndex: number;
  total: number;
  label: string;
}) {
  return (
    <div className="mt-6">
      <ol className="flex items-center gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, index) => (
          <li key={index} className="flex flex-1 items-center gap-1.5 last:flex-none">
            <span
              className={cn(
                "size-1.5 rounded-full transition-colors",
                index < currentIndex
                  ? "bg-primary"
                  : index === currentIndex
                    ? "bg-primary ring-4 ring-primary/20"
                    : "bg-border",
              )}
            />
            {index < total - 1 && (
              <span
                className={cn(
                  "h-px flex-1 transition-colors",
                  index < currentIndex ? "bg-primary/50" : "bg-border",
                )}
              />
            )}
          </li>
        ))}
      </ol>
      <p className={cn("mt-2", flowRowLabelClassName)} aria-live="polite">
        {label}
      </p>
    </div>
  );
}

/** Title + one sentence at the top of a step. */
export function StepHeading({
  title,
  description,
  className,
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <h2 className="text-xl font-semibold leading-tight tracking-tight text-foreground">
        {title}
      </h2>
      {description ? (
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

/** Footer of a phase: back + forward. Primary on top on narrow widths (`flex-col-reverse`). */
export function StepActions({
  back,
  children,
  className,
}: {
  back?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col-reverse gap-2 pt-1 sm:flex-row", className)}>
      {back}
      {children}
    </div>
  );
}

/** Large selectable card with an icon, a title and one sentence (the objective step). */
export function SelectionCard({
  icon: Icon,
  title,
  description,
  selected,
  onClick,
  disabled = false,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "w-full rounded-lg border bg-card p-4 text-left transition-colors sm:p-5",
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/30 hover:bg-muted/40",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-md border border-primary/10 bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-5" />
        </span>
        <span className="text-[15px] font-semibold leading-snug tracking-tight">{title}</span>
      </div>
      <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
    </button>
  );
}

function isPortaledOverlayEvent(event: { target: EventTarget | null }): boolean {
  return (
    event.target instanceof Element &&
    Boolean(
      event.target.closest(
        "[data-radix-select-content], [data-radix-select-viewport], [data-radix-popover-content], [data-radix-popper-content-wrapper], [data-slot=calendar]",
      ),
    )
  );
}

/**
 * Review-only editor. Cancel / X / overlay discard the local draft; Salvar commits.
 * Period, hours, location, placements, CTA and link never become inbound steps.
 */
export function ReviewEditSheet({
  open,
  title,
  description,
  saveDisabled,
  saveLabel = "Salvar",
  cancelLabel = "Cancelar",
  onOpenChange,
  onSave,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  saveDisabled?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  children: ReactNode;
}) {
  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="z-[90] flex h-full w-full flex-col overflow-hidden sm:max-w-lg md:max-w-xl lg:max-w-2xl"
        onFocusOutside={(event) => {
          event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isPortaledOverlayEvent(event)) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isPortaledOverlayEvent(event)) event.preventDefault();
        }}
      >
        <SheetHeader className="shrink-0 pr-8">
          <SheetTitle className="text-lg font-semibold">{title}</SheetTitle>
          <SheetDescription className="text-left">{description}</SheetDescription>
        </SheetHeader>
        <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>
        <SheetFooter className="mt-4 shrink-0 flex-col gap-2 border-t pt-4 sm:flex-col sm:space-x-0">
          <Button type="button" className="h-10 w-full" disabled={saveDisabled} onClick={onSave}>
            {saveLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full"
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
