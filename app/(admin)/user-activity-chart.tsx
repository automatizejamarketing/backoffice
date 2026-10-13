"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChartColumn } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  Rectangle,
  ReferenceLine,
  XAxis,
  YAxis,
  type RectangleProps,
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
import { PAID_ACCESS_GRACE_DAYS } from "@/lib/backoffice/paid-access-periods";
import { userActivityAxisScale } from "@/lib/backoffice/user-activity-chart-scale";
import {
  UserActivityUsersSheet,
  type UserActivityDaySelection,
} from "./user-activity-users-sheet";

const PAYMENTS_COLOR = "oklch(0.62 0.16 230)";
const TRIALS_COLOR = "oklch(0.8 0.11 200)";
const SIGNUPS_COLOR = "oklch(0.72 0.16 155)";
const DAY_EVENT_COLORS = [PAYMENTS_COLOR, TRIALS_COLOR, SIGNUPS_COLOR];

const SERIES = [
  {
    key: "newUsers",
    label: "Cadastros, trials e pagamentos",
    color: SIGNUPS_COLOR,
  },
  { key: "users", label: "Total de usuários", color: "oklch(0.62 0.19 255)" },
  { key: "activeUsers", label: "Clientes pagantes", color: "oklch(0.75 0.16 55)" },
  { key: "churn", label: "Churn", color: "oklch(0.64 0.21 25)" },
] as const;

const chartConfig = {
  newUsers: {
    label: "Cadastros",
    color: SIGNUPS_COLOR,
  },
  trials: {
    label: "Trials",
    color: TRIALS_COLOR,
  },
  payments: {
    label: "Pagamentos",
    color: PAYMENTS_COLOR,
  },
  users: {
    label: "Total de usuários",
    color: "oklch(0.62 0.19 255)",
  },
  activeUsers: {
    label: "Clientes pagantes",
    color: "oklch(0.75 0.16 55)",
  },
  churnDown: {
    label: "Churn",
    color: "oklch(0.64 0.21 25)",
  },
} satisfies ChartConfig;

function DayEventsSwatch({ className }: { className: string }) {
  return (
    <span className="flex shrink-0 overflow-hidden rounded-[2px]" aria-hidden>
      {DAY_EVENT_COLORS.map((color) => (
        <span key={color} className={className} style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}

// Recharts flips the corners of a negative bar, so the same radius rounds the
// top of a positive segment and the bottom of the churn below zero.
const BAR_TOP_RADIUS: [number, number, number, number] = [3, 3, 0, 0];

type BarShapeProps = RectangleProps & { payload?: { topBar?: string } };

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
  "newUsers",
  "trials",
  "payments",
  "users",
  "activeUsers",
  "churnDown",
] as const;

type TooltipPayloadItem = {
  dataKey?: string | number;
  value?: number | string;
  payload?: {
    date?: string;
    newUsers?: number;
    activeUsersChange?: number;
  };
};

function formatSaldo(value: number) {
  const formatted = Math.abs(value).toLocaleString("pt-BR");
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return "0";
}

function tooltipValue(
  payload: TooltipPayloadItem[],
  key: (typeof TOOLTIP_SERIES)[number],
) {
  const item = payload.find((entry) => entry.dataKey === key);
  if (!item || item.value == null) return null;
  // Churn is drawn below zero; the tooltip reads it as a count.
  return Math.abs(Number(item.value));
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
  const saldo = payload.find(
    (item) => item.payload?.activeUsersChange != null,
  )?.payload?.activeUsersChange;
  const rows = TOOLTIP_SERIES.flatMap((key) => {
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
  });

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
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: row.color }}
                aria-hidden
              />
              <span className="text-muted-foreground">{row.label}</span>
            </span>
            <span className="font-mono font-medium tabular-nums text-foreground">
              {row.value.toLocaleString("pt-BR")}
            </span>
          </div>
        ))}
      </div>
      {saldo != null ? (
        <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-1.5">
          <span className="text-muted-foreground">Saldo de pagantes</span>
          <span
            className="font-mono font-medium tabular-nums"
            style={{
              color:
                saldo > 0
                  ? SIGNUPS_COLOR
                  : saldo < 0
                    ? chartConfig.churnDown.color
                    : undefined,
            }}
          >
            {formatSaldo(saldo)}
          </span>
        </div>
      ) : null}
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

  // Bottom to top in the day's bar.
  const positiveBars = [
    ...(visible.newUsers
      ? ([
          { key: "payments", series: "payments" },
          { key: "trials", series: "trials" },
          { key: "newUsers", series: "newUsers" },
        ] as const)
      : []),
  ];
  const chartData = data.map((item) => {
    const values = {
      payments: item.payments,
      trials: item.trials,
      newUsers: item.newUsers,
    };
    return {
      ...item,
      users: item.totalUsers,
      churnDown: -item.churn,
      // Only the highest non-empty segment gets rounded corners.
      topBar: positiveBars.findLast((bar) => values[bar.key] > 0)?.key,
      dateLabel: formatShortDate(item.date),
    };
  });
  const showDaily = visible.newUsers || visible.churn;
  const showStock = visible.users || visible.activeUsers;
  const axes = userActivityAxisScale({
    dailyMax: visible.newUsers
      ? Math.max(
          0,
          ...data.map((item) => item.newUsers + item.trials + item.payments),
        )
      : 0,
    churnMax: visible.churn ? Math.max(0, ...data.map((item) => item.churn)) : 0,
    stockMax: Math.max(
      0,
      ...data.map((item) =>
        Math.max(
          visible.users ? item.totalUsers : 0,
          visible.activeUsers ? item.activeUsers : 0,
        ),
      ),
    ),
  });
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
                <span className="text-muted-foreground">
                  {visibleCount}/{SERIES.length}
                </span>
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
                      <DayEventsSwatch className="size-2.5" />
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
            stackOffset="sign"
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
              domain={axes.daily.domain}
              ticks={axes.daily.ticks}
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
              domain={axes.stock.domain}
              ticks={axes.stock.ticks}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={32}
              hide={!showStock}
            />
            <ChartTooltip content={<UserActivityTooltip />} />
            {showDaily ? (
              <ReferenceLine
                yAxisId="daily"
                y={0}
                stroke="var(--border)"
              />
            ) : null}
            {positiveBars.map((bar) => (
              <Bar
                key={bar.key}
                yAxisId="daily"
                dataKey={bar.key}
                stackId="daily"
                fill={`var(--color-${bar.key})`}
                maxBarSize={18}
                onClick={(data) => openSeries(bar.series, data)}
                shape={(props: BarShapeProps) => (
                  <Rectangle
                    {...props}
                    radius={
                      props.payload?.topBar === bar.key ? BAR_TOP_RADIUS : 0
                    }
                  />
                )}
              />
            ))}
            {visible.churn ? (
              <Bar
                yAxisId="daily"
                dataKey="churnDown"
                stackId="daily"
                fill="var(--color-churnDown)"
                maxBarSize={18}
                radius={BAR_TOP_RADIUS}
                onClick={(data) => openSeries("churn", data)}
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
          {[
            visible.newUsers
              ? "A barra soma o que aconteceu no dia: cadastros, trials iniciados e primeiros pagamentos de assinatura. Cada pessoa aparece no dia em que fez cada coisa."
              : null,
            visible.churn
              ? `Abaixo do zero, o churn: pagantes cujo acesso acabou naquele dia. Ele fica no dia da saída mesmo se a pessoa voltar; quem renova em até ${PAID_ACCESS_GRACE_DAYS} dias não conta como saída.`
              : null,
            splitAxes
              ? "O eixo da direita mostra o estoque do dia (total e pagantes)."
              : null,
            "Clique numa barra ou ponto para ver a lista daquele dia.",
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}

      <UserActivityUsersSheet
        selection={selection}
        onClose={() => setSelection(null)}
      />
    </div>
  );
}
