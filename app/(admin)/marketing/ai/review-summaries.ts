import {
  META_SCHEDULE_DAY_ORDER,
  type CampaignDeliveryMode,
  type CampaignScheduleBlock,
  type MetaScheduleDay,
} from "@/lib/meta-business/campaign-schedule";

const DAY_SHORT: Record<MetaScheduleDay, string> = {
  1: "Seg",
  2: "Ter",
  3: "Qua",
  4: "Qui",
  5: "Sex",
  6: "Sáb",
  0: "Dom",
};

function minuteLabel(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function daysLabel(days: ReadonlySet<MetaScheduleDay>): string {
  if (days.size === 7) return "Todos os dias";
  if (days.size === 2 && days.has(6) && days.has(0)) return "Fim de semana";
  const ordered = META_SCHEDULE_DAY_ORDER.filter((day) => days.has(day));
  const indices = ordered.map((day) => META_SCHEDULE_DAY_ORDER.indexOf(day));
  const contiguous = indices.every(
    (index, position) => position === 0 || index === indices[position - 1] + 1,
  );
  // A run of three or more days reads as a range: "Seg a sex", "Seg a sáb".
  if (contiguous && ordered.length >= 3) {
    const first = DAY_SHORT[ordered[0]];
    const last = DAY_SHORT[ordered[ordered.length - 1]].toLowerCase();
    return `${first} a ${last}`;
  }
  return ordered.map((day) => DAY_SHORT[day]).join(", ");
}

/**
 * One line for the review row: when the ads run. Blocks sharing the same hours are folded into
 * one entry (the editor stores one block per day), in the order the hours first appear.
 */
export function scheduleSummary(value: {
  deliveryMode: CampaignDeliveryMode;
  scheduleBlocks: CampaignScheduleBlock[];
}): string {
  if (value.deliveryMode === "all_day") return "Dia todo";
  if (value.scheduleBlocks.length === 0) return "Nenhum horário escolhido";
  const byHours = new Map<string, { start: number; end: number; days: Set<MetaScheduleDay> }>();
  for (const block of value.scheduleBlocks) {
    const key = `${block.startMinute}-${block.endMinute}`;
    const entry = byHours.get(key) ?? {
      start: block.startMinute,
      end: block.endMinute,
      days: new Set<MetaScheduleDay>(),
    };
    for (const day of block.days) entry.days.add(day);
    byHours.set(key, entry);
  }
  return [...byHours.values()]
    .map((entry) => `${daysLabel(entry.days)} ${minuteLabel(entry.start)}–${minuteLabel(entry.end)}`)
    .join(" · ");
}
