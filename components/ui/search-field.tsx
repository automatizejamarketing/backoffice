"use client";
import { useRef, type ComponentProps } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SearchFieldProps = Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "type" | "ref"
> & {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
};
export function SearchField({
  value,
  onValueChange,
  label,
  className,
  disabled,
  ...props
}: SearchFieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        {...props}
        ref={ref}
        type="search"
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onValueChange(e.target.value)}
        className="pl-9 pr-12 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={`Limpar ${label.toLocaleLowerCase("pt-BR")}`}
          className="absolute right-0 top-1/2 -translate-y-1/2"
          onClick={() => {
            onValueChange("");
            ref.current?.focus();
          }}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
