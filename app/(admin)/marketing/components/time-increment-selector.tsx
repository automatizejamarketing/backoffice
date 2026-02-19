"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TimeIncrement } from "@/lib/meta-business/types";

type TimeIncrementSelectorProps = {
  value: TimeIncrement;
  onChange: (value: TimeIncrement) => void;
  disabled?: boolean;
};

const INCREMENT_LABELS: Record<TimeIncrement, string> = {
  day: "Dia",
  week: "Semana",
  month: "Mês",
  quarterly: "Trimestre",
};

export function TimeIncrementSelector({
  value,
  onChange,
  disabled = false,
}: TimeIncrementSelectorProps) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as TimeIncrement)}
      disabled={disabled}
    >
      <SelectTrigger className="w-[120px]">
        <SelectValue>{INCREMENT_LABELS[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(INCREMENT_LABELS) as TimeIncrement[]).map((increment) => (
          <SelectItem key={increment} value={increment}>
            {INCREMENT_LABELS[increment]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
