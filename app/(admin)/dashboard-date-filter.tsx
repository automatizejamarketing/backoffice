"use client";

import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import type {
  DashboardDatePreset,
  DashboardDateWindow,
} from "@/lib/backoffice/dashboard-date-range";
import { useDashboardNavigation } from "./dashboard-navigation-feedback";

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

export function DashboardDateFilter({
  basePath,
  window,
}: {
  basePath: string;
  window: DashboardDateWindow;
}) {
  const { navigate } = useDashboardNavigation();

  function applyPreset(preset: Exclude<DashboardDatePreset, "custom">) {
    navigate(
      preset === "last_30_days" ? basePath : `${basePath}?range=${preset}`,
    );
  }

  return (
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
      <DateRangePicker
        date={
          window.preset === "custom"
            ? {
                from: parseCalendarDate(window.fromDate),
                to: parseCalendarDate(window.throughDate),
              }
            : undefined
        }
        disabledAfter={new Date()}
        placeholder="Personalizado"
        active={window.preset === "custom"}
        triggerVariant={window.preset === "custom" ? "secondary" : "ghost"}
        className="h-8 max-w-56 px-3 text-xs shadow-none"
        onDateChange={({ from, to }) => {
          if (!from || !to) return;
          const params = new URLSearchParams({
            range: "custom",
            from: formatCalendarDate(from),
            to: formatCalendarDate(to),
          });
          navigate(`${basePath}?${params.toString()}`);
        }}
      />
    </nav>
  );
}
