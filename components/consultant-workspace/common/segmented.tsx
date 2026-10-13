"use client";

import { cn } from "@/lib/utils";

/** Botões lado a lado com um escolhido (período, ordem…). */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: React.ReactNode; title?: string }>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex h-7 items-center rounded-md border bg-muted/40 p-0.5 text-xs", className)}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          title={option.title}
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-full items-center gap-1.5 rounded-[5px] px-2 font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
            option.value === value && "bg-background text-foreground shadow-sm",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
