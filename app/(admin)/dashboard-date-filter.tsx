"use client";

import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DateRangeDialog } from "@/components/date-range-dialog";
import type {
  DashboardDatePreset,
  DashboardDateWindow,
} from "@/lib/backoffice/dashboard-date-range";

const presets: Array<{
  value: Exclude<DashboardDatePreset, "custom">;
  label: string;
}> = [
  { value: "this_month", label: "Este mês" },
  { value: "last_30_days", label: "Últimos 30 dias" },
  { value: "last_month", label: "Mês passado" },
];

function parseCalendarDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function formatCalendarDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(parseCalendarDate(value));
}

export function DashboardDateFilter({
  basePath,
  window,
}: {
  basePath: string;
  window: DashboardDateWindow;
}) {
  const router = useRouter();
  const [customOpen, setCustomOpen] = useState(false);

  function applyPreset(preset: Exclude<DashboardDatePreset, "custom">) {
    router.push(
      preset === "last_30_days" ? basePath : `${basePath}?range=${preset}`,
    );
  }

  return (
    <>
      <nav
        aria-label="Período dos dados"
        className="flex w-full flex-wrap items-center gap-1 rounded-lg border bg-muted/30 p-1 sm:w-fit"
      >
        {presets.map((preset) => (
          <Button
            key={preset.value}
            type="button"
            size="sm"
            variant={window.preset === preset.value ? "secondary" : "ghost"}
            className="h-8 px-3 text-xs shadow-none"
            aria-pressed={window.preset === preset.value}
            onClick={() => applyPreset(preset.value)}
          >
            {preset.label}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant={window.preset === "custom" ? "secondary" : "ghost"}
          className="h-8 gap-1.5 px-3 text-xs shadow-none"
          aria-pressed={window.preset === "custom"}
          onClick={() => setCustomOpen(true)}
        >
          <CalendarRange className="size-3.5" />
          {window.preset === "custom"
            ? `${formatShortDate(window.fromDate)} – ${formatShortDate(window.throughDate)}`
            : "Personalizado"}
        </Button>
      </nav>

      <DateRangeDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        initialRange={{
          from: parseCalendarDate(window.fromDate),
          to: parseCalendarDate(window.throughDate),
        }}
        disabledAfter={new Date()}
        onApply={({ from, to }) => {
          const params = new URLSearchParams({
            range: "custom",
            from: formatCalendarDate(from),
            to: formatCalendarDate(to),
          });
          router.push(`${basePath}?${params.toString()}`);
        }}
      />
    </>
  );
}
