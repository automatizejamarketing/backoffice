"use client";

import { useMemo } from "react";
import { Clock3, Plus, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  normalizeCampaignScheduleBlocks,
  type CampaignDeliveryMode,
  type CampaignScheduleBlock,
  type MetaScheduleDay,
} from "@/lib/meta-business/campaign-schedule";

export type AdSetDeliveryScheduleValue = {
  deliveryMode: CampaignDeliveryMode;
  scheduleBlocks: CampaignScheduleBlock[];
};

type AdSetDeliveryScheduleEditorProps = {
  value: AdSetDeliveryScheduleValue;
  onChange: (nextValue: AdSetDeliveryScheduleValue) => void;
  disabled?: boolean;
};

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const DEFAULT_SHIFT_START = 9 * MINUTES_PER_HOUR;
const DEFAULT_SHIFT_END = 18 * MINUTES_PER_HOUR;

const DAY_COLUMNS: Array<{
  day: MetaScheduleDay;
  label: string;
  shortLabel: string;
}> = [
  { day: 1, label: "Segunda-feira", shortLabel: "Seg" },
  { day: 2, label: "Terca-feira", shortLabel: "Ter" },
  { day: 3, label: "Quarta-feira", shortLabel: "Qua" },
  { day: 4, label: "Quinta-feira", shortLabel: "Qui" },
  { day: 5, label: "Sexta-feira", shortLabel: "Sex" },
  { day: 6, label: "Sabado", shortLabel: "Sab" },
  { day: 0, label: "Domingo", shortLabel: "Dom" },
];

const START_TIME_OPTIONS = Array.from({ length: 24 }, (_, hour) =>
  `${hour.toString().padStart(2, "0")}:00`,
);
const END_TIME_OPTIONS = [...START_TIME_OPTIONS, "24:00"];

type DayShift = { startMinute: number; endMinute: number };
type DayScheduleCard = {
  day: MetaScheduleDay;
  enabled: boolean;
  shifts: DayShift[];
};

function minuteToTimeString(minute: number): string {
  if (minute === MINUTES_PER_DAY) return "24:00";
  const hours = Math.floor(minute / MINUTES_PER_HOUR)
    .toString()
    .padStart(2, "0");
  const minutes = (minute % MINUTES_PER_HOUR).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function timeStringToMinute(value: string): number {
  if (value === "24:00") return MINUTES_PER_DAY;
  const [hours, minutes] = value.split(":");
  return (
    Number.parseInt(hours ?? "0", 10) * MINUTES_PER_HOUR +
    Number.parseInt(minutes ?? "0", 10)
  );
}

function normalizeDayShifts(shifts: DayShift[]): DayShift[] {
  return [...shifts].sort((left, right) =>
    left.startMinute !== right.startMinute
      ? left.startMinute - right.startMinute
      : left.endMinute - right.endMinute,
  );
}

function blocksToCards(blocks: CampaignScheduleBlock[]): DayScheduleCard[] {
  const shiftsByDay = new Map<MetaScheduleDay, DayShift[]>();
  for (const block of normalizeCampaignScheduleBlocks(blocks)) {
    for (const day of block.days) {
      const current = shiftsByDay.get(day) ?? [];
      current.push({
        startMinute: block.startMinute,
        endMinute: block.endMinute,
      });
      shiftsByDay.set(day, current);
    }
  }

  return DAY_COLUMNS.map(({ day }) => {
    const shifts = normalizeDayShifts(shiftsByDay.get(day) ?? []);
    return { day, enabled: shifts.length > 0, shifts };
  });
}

function cardsToBlocks(cards: DayScheduleCard[]): CampaignScheduleBlock[] {
  return normalizeCampaignScheduleBlocks(
    cards.flatMap((card) =>
      card.enabled
        ? card.shifts.map((shift) => ({
            days: [card.day],
            startMinute: shift.startMinute,
            endMinute: shift.endMinute,
          }))
        : [],
    ),
  );
}

function createPresetBlocks(
  mode: "everyday" | "weekdays" | "weekend" | "clear",
): CampaignScheduleBlock[] {
  if (mode === "clear") return [];

  return DAY_COLUMNS.filter(({ day }) => {
    if (mode === "weekdays") return day >= 1 && day <= 5;
    if (mode === "weekend") return day === 6 || day === 0;
    return true;
  }).map(({ day }) => ({
    days: [day],
    startMinute: 0,
    endMinute: MINUTES_PER_DAY,
  }));
}

function canFitShift(
  shifts: DayShift[],
  startMinute: number,
  endMinute: number,
): boolean {
  return !shifts.some(
    (shift) => startMinute < shift.endMinute && endMinute > shift.startMinute,
  );
}

function findAvailableShift(shifts: DayShift[]): DayShift | null {
  if (shifts.length === 0) {
    return { startMinute: DEFAULT_SHIFT_START, endMinute: DEFAULT_SHIFT_END };
  }

  for (let startMinute = 0; startMinute < MINUTES_PER_DAY; startMinute += 60) {
    const endMinute = startMinute + MINUTES_PER_HOUR;
    if (endMinute <= MINUTES_PER_DAY && canFitShift(shifts, startMinute, endMinute)) {
      return { startMinute, endMinute };
    }
  }

  return null;
}

function countScheduledHours(blocks: CampaignScheduleBlock[]): number {
  return blocks.reduce(
    (total, block) =>
      total +
      ((block.endMinute - block.startMinute) / MINUTES_PER_HOUR) *
        block.days.length,
    0,
  );
}

export function AdSetDeliveryScheduleEditor({
  value,
  onChange,
  disabled = false,
}: AdSetDeliveryScheduleEditorProps) {
  const dayCards = useMemo(
    () => blocksToCards(value.scheduleBlocks),
    [value.scheduleBlocks],
  );
  const selectedHours = countScheduledHours(value.scheduleBlocks);

  const updateValue = (patch: Partial<AdSetDeliveryScheduleValue>) => {
    onChange({ ...value, ...patch });
  };

  const updateDayCards = (nextCards: DayScheduleCard[]) => {
    updateValue({ scheduleBlocks: cardsToBlocks(nextCards) });
  };

  const setDeliveryMode = (deliveryMode: CampaignDeliveryMode) => {
    updateValue({
      deliveryMode,
      scheduleBlocks:
        deliveryMode === "all_day"
          ? []
          : value.scheduleBlocks.length > 0
            ? value.scheduleBlocks
            : createPresetBlocks("weekdays"),
    });
  };

  const toggleDay = (day: MetaScheduleDay, checked: boolean) => {
    updateDayCards(
      dayCards.map((card) => {
        if (card.day !== day) return card;
        if (!checked) return { ...card, enabled: false, shifts: [] };
        return {
          ...card,
          enabled: true,
          shifts:
            card.shifts.length > 0
              ? card.shifts
              : [{ startMinute: DEFAULT_SHIFT_START, endMinute: DEFAULT_SHIFT_END }],
        };
      }),
    );
  };

  const addShift = (day: MetaScheduleDay) => {
    updateDayCards(
      dayCards.map((card) => {
        if (card.day !== day) return card;
        const nextShift = findAvailableShift(card.shifts);
        if (!nextShift) return card;
        return {
          ...card,
          enabled: true,
          shifts: normalizeDayShifts([...card.shifts, nextShift]),
        };
      }),
    );
  };

  const removeShift = (day: MetaScheduleDay, shiftIndex: number) => {
    updateDayCards(
      dayCards.map((card) => {
        if (card.day !== day) return card;
        const shifts = card.shifts.filter((_, index) => index !== shiftIndex);
        return { ...card, enabled: shifts.length > 0, shifts };
      }),
    );
  };

  const updateShiftTime = (
    day: MetaScheduleDay,
    shiftIndex: number,
    field: keyof DayShift,
    nextValue: string,
  ) => {
    updateDayCards(
      dayCards.map((card) => {
        if (card.day !== day) return card;
        return {
          ...card,
          shifts: normalizeDayShifts(
            card.shifts.map((shift, index) =>
              index === shiftIndex
                ? { ...shift, [field]: timeStringToMinute(nextValue) }
                : shift,
            ),
          ),
        };
      }),
    );
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Clock3 className="size-4 text-primary" />
          <Label className="text-sm font-semibold">Dias e horarios</Label>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure se o anúncio fica ativo o dia todo ou apenas em horários
          específicos.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setDeliveryMode("specific_hours")}
          className={cn(
            "rounded-xl border p-3 text-left transition-colors disabled:opacity-50",
            value.deliveryMode === "specific_hours"
              ? "border-primary bg-primary/10"
              : "border-border bg-muted/20 hover:bg-muted/40",
          )}
        >
          <div className="flex items-center gap-2 font-semibold">
            <Clock3 className="size-4" />
            Somente horarios escolhidos
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Use quando a operação atende melhor em dias e turnos específicos.
          </p>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => setDeliveryMode("all_day")}
          className={cn(
            "rounded-xl border p-3 text-left transition-colors disabled:opacity-50",
            value.deliveryMode === "all_day"
              ? "border-primary bg-primary/10"
              : "border-border bg-muted/20 hover:bg-muted/40",
          )}
        >
          <div className="flex items-center gap-2 font-semibold">
            <Zap className="size-4" />
            Todos os dias e horarios
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Permite que a Meta entregue os anúncios durante todo o período.
          </p>
        </button>
      </div>

      {value.deliveryMode === "specific_hours" && (
        <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              {selectedHours.toFixed(0)}h selecionadas na semana
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => updateValue({ scheduleBlocks: createPresetBlocks("everyday") })}
              >
                Todos os dias
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => updateValue({ scheduleBlocks: createPresetBlocks("weekdays") })}
              >
                Dias uteis
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => updateValue({ scheduleBlocks: [] })}
              >
                Limpar
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {DAY_COLUMNS.map((column, dayIndex) => {
              const card = dayCards[dayIndex];
              const availableShift = findAvailableShift(card.shifts);

              return (
                <div
                  key={column.day}
                  className={cn(
                    "rounded-xl border bg-background",
                    card.enabled ? "border-primary/40" : "border-border",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={card.enabled}
                        onCheckedChange={(checked) =>
                          toggleDay(column.day, checked)
                        }
                        disabled={disabled}
                      />
                      <div>
                        <p className="text-sm font-semibold">{column.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {column.shortLabel}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {card.enabled ? `${card.shifts.length} turno(s)` : "Inativo"}
                    </span>
                  </div>

                  {card.enabled && (
                    <div className="space-y-2 border-t border-border p-3">
                      {card.shifts.map((shift, shiftIndex) => (
                        <div
                          key={`${column.day}-${shiftIndex}`}
                          className="rounded-lg border border-border bg-muted/20 p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">
                              Turno {shiftIndex + 1}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={disabled}
                              onClick={() => removeShift(column.day, shiftIndex)}
                            >
                              <Trash2 className="mr-2 size-4" />
                              Remover
                            </Button>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Select
                              value={minuteToTimeString(shift.startMinute)}
                              onValueChange={(value) =>
                                updateShiftTime(
                                  column.day,
                                  shiftIndex,
                                  "startMinute",
                                  value,
                                )
                              }
                              disabled={disabled}
                            >
                              <SelectTrigger className="w-[130px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {START_TIME_OPTIONS.map((time) => (
                                  <SelectItem key={`start-${time}`} value={time}>
                                    {time}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <span className="text-sm text-muted-foreground">ate</span>
                            <Select
                              value={minuteToTimeString(shift.endMinute)}
                              onValueChange={(value) =>
                                updateShiftTime(
                                  column.day,
                                  shiftIndex,
                                  "endMinute",
                                  value,
                                )
                              }
                              disabled={disabled}
                            >
                              <SelectTrigger className="w-[130px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {END_TIME_OPTIONS.map((time) => (
                                  <SelectItem key={`end-${time}`} value={time}>
                                    {time === "24:00" ? "24:00" : time}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {shift.startMinute >= shift.endMinute && (
                            <p className="mt-2 text-xs font-medium text-destructive">
                              O horario final precisa ser posterior ao inicial.
                            </p>
                          )}
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full border-dashed"
                        disabled={disabled || !availableShift}
                        onClick={() => addShift(column.day)}
                      >
                        <Plus className="mr-2 size-4" />
                        Adicionar turno
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
