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
  type ChartConfig,
} from "@/components/ui/chart";
import type {
  DailyUserActivity,
  UserActivityDaySeriesKey,
} from "@/lib/backoffice/user-activity-dashboard";
import { formatCalendarWeekdayLabel } from "@/lib/backoffice/datetime-format";
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

const NEW_USERS_ACTIVATED_COLOR = "oklch(0.62 0.16 230)";

const chartConfig = {
  newUsersActivated: {
    label: "Trial ou pagamento",
    color: NEW_USERS_ACTIVATED_COLOR,
  },
  newUsersRest: {
    label: "Só cadastro",
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

const TOOLTIP_SERIES = [
  "newUsersActivated",
  "newUsersRest",
  "users",
  "activeUsers",
] as const;

type TooltipPayloadItem = {
  dataKey?: string | number;
  value?: number | string;
  payload?: {
    date?: string;
    newUsers?: number;
    newUsersActivated?: number;
    newUsersRest?: number;
  };
};

function tooltipValue(
  payload: TooltipPayloadItem[],
  key: (typeof TOOLTIP_SERIES)[number],
) {
  const item = payload.find((entry) => entry.dataKey === key);
  if (!item || item.value == null) return null;
  return Number(item.value);
}

function UserActivityTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) {
  if (!active || !payload?.length) return null;

  const date = payload.find((item) => item.payload?.date)?.payload?.date;
  const activated = tooltipValue(payload, "newUsersActivated");
  const rest = tooltipValue(payload, "newUsersRest");
  const newUsersTotal =
    payload.find((item) => item.payload?.newUsers != null)?.payload?.newUsers ??
    (activated ?? 0) + (rest ?? 0);
  const rows = [
    activated != null || rest != null
      ? {
          key: "newUsers",
          value: newUsersTotal,
          label: "Usuários novos",
          color: chartConfig.newUsersRest.color,
        }
      : null,
    ...TOOLTIP_SERIES.flatMap((key) => {
      const value = tooltipValue(payload, key);
      if (value == null) return [];
      return [
        {
          key,
          value,
          label: chartConfig[key].label,
          color: chartConfig[key].color,
        },
      ];
    }),
  ].filter((row) => row !== null);

  if (!rows.length) return null;

  return (
    <div className="grid min-w-[10rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      {date ? (
        <div className="font-medium">{formatCalendarWeekdayLabel(date)}</div>
      ) : null}
      <div className="grid gap-1.5">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              {row.key === "newUsers" ? (
                <span
                  className="flex size-2.5 shrink-0 overflow-hidden rounded-[2px]"
                  aria-hidden
                >
                  <span
                    className="h-full w-1/2"
                    style={{ backgroundColor: chartConfig.newUsersActivated.color }}
                  />
                  <span
                    className="h-full w-1/2"
                    style={{ backgroundColor: chartConfig.newUsersRest.color }}
                  />
                </span>
              ) : (
                <span
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: row.color }}
                  aria-hidden
                />
              )}
              <span className="text-muted-foreground">{row.label}</span>
            </span>
            <span className="font-mono font-medium tabular-nums text-foreground">
              {row.value.toLocaleString("pt-BR")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function dateFromChartPayload(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as {
    date?: unknown;
    payload?: { date?: unknown };
  };
  if (typeof record.date === "string") return record.date;
  if (typeof record.payload?.date === "string") return record.payload.date;
  return null;
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
    newUsersRest: Math.max(item.newUsers - item.newUsersActivated, 0),
    dateLabel: formatShortDate(item.date),
  }));
  const showDaily = visible.newUsers;
  const showStock = visible.users || visible.activeUsers;
  const splitAxes = showDaily && showStock;
  const hasVisibleSeries = showDaily || showStock;
  const visibleCount = SERIES.filter((series) => visible[series.key]).length;

  function openSeries(series: UserActivityDaySeriesKey, input: unknown) {
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
                    {series.key === "newUsers" ? (
                      <span className="flex overflow-hidden rounded-[2px]" aria-hidden>
                        <span
                          className="size-2.5"
                          style={{ background: NEW_USERS_ACTIVATED_COLOR }}
                        />
                        <span
                          className="size-2.5"
                          style={{ background: series.color }}
                        />
                      </span>
                    ) : (
                      <span
                        className="size-2.5 rounded-[2px]"
                        style={{ background: series.color }}
                        aria-hidden
                      />
                    )}
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
            <ChartTooltip content={<UserActivityTooltip />} />
            {visible.newUsers ? (
              <Bar
                yAxisId="daily"
                dataKey="newUsersActivated"
                stackId="newUsers"
                fill="var(--color-newUsersActivated)"
                maxBarSize={18}
                onClick={(data) => openSeries("newUsersActivated", data)}
              />
            ) : null}
            {visible.newUsers ? (
              <Bar
                yAxisId="daily"
                dataKey="newUsersRest"
                stackId="newUsers"
                fill="var(--color-newUsersRest)"
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
            ? "A fatia mais escura da barra são cadastros que já entraram em trial ou pagaram — não há histórico de trial para todo mundo. O eixo da direita mostra o estoque do dia (total e pagantes). Clique numa barra ou ponto para ver a lista daquele dia."
            : "A fatia mais escura da barra são cadastros que já entraram em trial ou pagaram. Clique numa barra ou ponto para ver a lista daquele dia."}
        </p>
      ) : null}

      <UserActivityUsersSheet
        selection={selection}
        onClose={() => setSelection(null)}
      />
    </div>
  );
}
