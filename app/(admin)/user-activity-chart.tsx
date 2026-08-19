"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChartColumn } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { DailyUserActivity } from "@/lib/backoffice/user-activity-dashboard";
import { formatCalendarDateLabel } from "@/lib/backoffice/datetime-format";
import {
  DEFAULT_USER_ACTIVITY_SERIES_VISIBILITY,
  USER_ACTIVITY_SERIES_STORAGE_KEY,
  parseUserActivitySeriesVisibility,
  serializeUserActivitySeriesVisibility,
  type UserActivitySeriesVisibility,
} from "@/lib/backoffice/user-activity-series";
import {
  UserActivityUsersSheet,
  type UserActivityDaySelection,
} from "./user-activity-users-sheet";

const SERIES = [
  { key: "newUsers", label: "Usuários novos", color: "oklch(0.72 0.16 155)" },
  { key: "users", label: "Total de usuários", color: "oklch(0.62 0.19 255)" },
  { key: "activeUsers", label: "Clientes pagantes", color: "oklch(0.75 0.16 55)" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

const chartConfig = {
  newUsers: {
    label: "Usuários novos",
    color: "oklch(0.72 0.16 155)",
  },
  users: {
    label: "Total de usuários",
    color: "oklch(0.62 0.19 255)",
  },
  activeUsers: {
    label: "Clientes pagantes",
    color: "oklch(0.75 0.16 55)",
  },
} satisfies ChartConfig;

const subscribeToClient = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function formatShortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

function readStoredVisibility(): UserActivitySeriesVisibility {
  try {
    return parseUserActivitySeriesVisibility(
      window.localStorage.getItem(USER_ACTIVITY_SERIES_STORAGE_KEY),
    );
  } catch {
    return { ...DEFAULT_USER_ACTIVITY_SERIES_VISIBILITY };
  }
}

function writeStoredVisibility(visibility: UserActivitySeriesVisibility) {
  try {
    window.localStorage.setItem(
      USER_ACTIVITY_SERIES_STORAGE_KEY,
      serializeUserActivitySeriesVisibility(visibility),
    );
  } catch {
    // Private mode should still let the user toggle series in this session.
  }
}

function dateFromChartPayload(input: {
  date?: string;
  payload?: { date?: string };
}): string | null {
  return input.date ?? input.payload?.date ?? null;
}

export function UserActivityChart({
  data,
  dateFilter,
  heading,
  children,
}: {
  data: DailyUserActivity[];
  dateFilter: ReactNode;
  heading: ReactNode;
  children?: ReactNode;
}) {
  const [visible, setVisible] = useState<UserActivitySeriesVisibility>(
    DEFAULT_USER_ACTIVITY_SERIES_VISIBILITY,
  );
  const [hydrated, setHydrated] = useState(false);
  const [selection, setSelection] = useState<UserActivityDaySelection | null>(
    null,
  );
  const mounted = useSyncExternalStore(
    subscribeToClient,
    getClientSnapshot,
    getServerSnapshot,
  );

  useEffect(() => {
    setVisible(readStoredVisibility());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeStoredVisibility(visible);
  }, [hydrated, visible]);

  const chartData = data.map((item) => ({
    ...item,
    users: item.totalUsers,
    dateLabel: formatShortDate(item.date),
  }));
  const showDaily = visible.newUsers;
  const showStock = visible.users || visible.activeUsers;
  const splitAxes = showDaily && showStock;
  const hasVisibleSeries = showDaily || showStock;
  const visibleCount = SERIES.filter((series) => visible[series.key]).length;

  function openSeries(series: SeriesKey, input: { date?: string; payload?: { date?: string } }) {
    const date = dateFromChartPayload(input);
    if (!date) return;
    setSelection({ date, series });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        {heading}
        <div className="flex flex-wrap items-center gap-2">
          {dateFilter}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 px-3 text-xs shadow-none"
              >
                <ChartColumn data-icon="inline-start" />
                Séries
                <span className="text-muted-foreground">{visibleCount}/3</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Mostrar no gráfico</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {SERIES.map((series) => (
                <DropdownMenuCheckboxItem
                  key={series.key}
                  checked={visible[series.key]}
                  onCheckedChange={(checked) => {
                    setVisible((current) => ({
                      ...current,
                      [series.key]: checked === true,
                    }));
                  }}
                  onSelect={(event) => event.preventDefault()}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-[2px]"
                      style={{ background: series.color }}
                      aria-hidden
                    />
                    {series.label}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {children}

      {mounted && hasVisibleSeries ? (
        <ChartContainer
          config={chartConfig}
          className="h-[280px] w-full sm:h-[340px] [&_.recharts-rectangle]:cursor-pointer [&_.recharts-line]:cursor-pointer [&_.recharts-dot]:cursor-pointer"
        >
          <ComposedChart
            accessibilityLayer
            data={chartData}
            margin={{ top: 12, right: 10, bottom: 4, left: -18 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="dateLabel"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              minTickGap={28}
            />
            <YAxis
              yAxisId="daily"
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={32}
              hide={splitAxes ? false : showStock}
            />
            <YAxis
              yAxisId="stock"
              orientation={splitAxes ? "right" : "left"}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={32}
              hide={!showStock}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    const first = payload[0] as
                      | { payload?: { date?: string } }
                      | undefined;
                    return first?.payload?.date
                      ? formatCalendarDateLabel(first.payload.date)
                      : null;
                  }}
                />
              }
            />
            {visible.newUsers ? (
              <Bar
                yAxisId="daily"
                dataKey="newUsers"
                fill="var(--color-newUsers)"
                maxBarSize={18}
                radius={[3, 3, 0, 0]}
                onClick={(data) => openSeries("newUsers", data)}
              />
            ) : null}
            {visible.users ? (
              <Line
                type="linear"
                yAxisId="stock"
                dataKey="users"
                stroke="var(--color-users)"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                onClick={(data) => openSeries("users", data)}
              />
            ) : null}
            {visible.activeUsers ? (
              <Line
                type="linear"
                yAxisId="stock"
                dataKey="activeUsers"
                stroke="var(--color-activeUsers)"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                onClick={(data) => openSeries("activeUsers", data)}
              />
            ) : null}
          </ComposedChart>
        </ChartContainer>
      ) : mounted ? (
        <p className="flex h-[280px] items-center justify-center text-xs text-muted-foreground sm:h-[340px]">
          Ligue ao menos uma série para ver o gráfico.
        </p>
      ) : (
        <div className="h-[280px] w-full sm:h-[340px]" aria-hidden />
      )}

      {hasVisibleSeries ? (
        <p className="text-[11px] text-muted-foreground">
          {splitAxes
            ? "O eixo da direita mostra o estoque do dia (total e pagantes), para não esmagar as barras de novos. Clique numa barra ou ponto para ver a lista daquele dia."
            : "Clique numa barra ou ponto para ver a lista daquele dia."}
        </p>
      ) : null}

      <UserActivityUsersSheet
        selection={selection}
        onClose={() => setSelection(null)}
      />
    </div>
  );
}
