import { isFullWeekSchedule } from "@/lib/meta-business/schedule-shape";
import type { AdSetScheduleOverride } from "@/lib/meta-business/duplicate";

export const META_SCHEDULE_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export type MetaScheduleDay = (typeof META_SCHEDULE_DAY_ORDER)[number];

export type CampaignDeliveryMode = "all_day" | "specific_hours";

export type CampaignScheduleBlock = {
  days: MetaScheduleDay[];
  startMinute: number;
  endMinute: number;
};

export type MetaAdSetScheduleBlock = {
  days: MetaScheduleDay[];
  start_minute: number;
  end_minute: number;
};

export type GraphAdSetScheduleBlock = {
  days?: number[];
  start_minute?: number;
  end_minute?: number;
};

export type CampaignSchedulePayload = {
  startTime: string;
  endTime: string;
  deliveryMode: CampaignDeliveryMode;
  scheduleBlocks?: CampaignScheduleBlock[];
};

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_HOUR = 60;
const MIN_CAMPAIGN_RUNTIME_MS = 60 * 60 * 1000;

function isMetaScheduleDay(value: number): value is MetaScheduleDay {
  return META_SCHEDULE_DAY_ORDER.includes(value as MetaScheduleDay);
}

function isValidMinuteBoundary(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MINUTES_PER_DAY &&
    value % 30 === 0
  );
}

export function normalizeCampaignScheduleBlocks(
  blocks: CampaignScheduleBlock[] | undefined,
): CampaignScheduleBlock[] {
  if (!blocks) return [];

  return blocks
    .map((block) => ({
      days: [...new Set(block.days)].sort(
        (left, right) =>
          META_SCHEDULE_DAY_ORDER.indexOf(left) -
          META_SCHEDULE_DAY_ORDER.indexOf(right),
      ) as MetaScheduleDay[],
      startMinute: block.startMinute,
      endMinute: block.endMinute,
    }))
    .sort((left, right) => {
      if (left.startMinute !== right.startMinute) {
        return left.startMinute - right.startMinute;
      }
      if (left.endMinute !== right.endMinute) {
        return left.endMinute - right.endMinute;
      }
      return left.days[0] - right.days[0];
    });
}

export function normalizeCampaignScheduleBlocksForMeta(
  blocks: CampaignScheduleBlock[] | undefined,
): CampaignScheduleBlock[] {
  const flattenedBlocks = normalizeCampaignScheduleBlocks(blocks).flatMap(
    (block) =>
      block.days.map((day) => {
        const startMinute = Math.max(
          0,
          Math.floor(block.startMinute / MINUTES_PER_HOUR) * MINUTES_PER_HOUR,
        );
        const roundedEndMinute = Math.min(
          MINUTES_PER_DAY,
          Math.ceil(block.endMinute / MINUTES_PER_HOUR) * MINUTES_PER_HOUR,
        );

        return {
          day,
          startMinute,
          endMinute: Math.max(startMinute + MINUTES_PER_HOUR, roundedEndMinute),
        };
      }),
  );

  const mergedBlocks: Array<{
    day: MetaScheduleDay;
    startMinute: number;
    endMinute: number;
  }> = [];

  for (const block of flattenedBlocks) {
    const previousBlock = mergedBlocks[mergedBlocks.length - 1];

    if (
      previousBlock &&
      previousBlock.day === block.day &&
      previousBlock.endMinute >= block.startMinute
    ) {
      previousBlock.endMinute = Math.max(previousBlock.endMinute, block.endMinute);
      continue;
    }

    mergedBlocks.push(block);
  }

  return mergedBlocks.map((block) => ({
    days: [block.day],
    startMinute: block.startMinute,
    endMinute: block.endMinute,
  }));
}

export function validateCampaignSchedulePayload(
  payload: CampaignSchedulePayload,
): string | null {
  const startDate = new Date(payload.startTime);
  const endDate = new Date(payload.endTime);

  if (Number.isNaN(startDate.getTime())) return "startTime must be valid";
  if (Number.isNaN(endDate.getTime())) return "endTime must be valid";
  if (endDate.getTime() <= startDate.getTime()) {
    return "endTime must be after startTime";
  }
  if (endDate.getTime() - startDate.getTime() < MIN_CAMPAIGN_RUNTIME_MS) {
    return "Campaign must run for at least one hour";
  }

  return validateCampaignScheduleBlocks(payload.deliveryMode, payload.scheduleBlocks);
}

/** Block rules without a flight window — used where the dates come later (duplicate with new schedule). */
export function validateCampaignScheduleBlocks(
  deliveryMode: CampaignDeliveryMode,
  scheduleBlocks: CampaignScheduleBlock[] | undefined,
): string | null {
  const normalizedBlocks = normalizeCampaignScheduleBlocks(scheduleBlocks);

  if (deliveryMode === "all_day") {
    return normalizedBlocks.length > 0
      ? "scheduleBlocks can only be provided for specific hours"
      : null;
  }

  if (deliveryMode !== "specific_hours") {
    return "deliveryMode must be all_day or specific_hours";
  }

  if (normalizedBlocks.length === 0) {
    return "scheduleBlocks must contain at least one block";
  }

  const occupiedSlots = new Set<string>();

  for (const block of normalizedBlocks) {
    if (block.days.length === 0) {
      return "Each schedule block must include at least one day";
    }
    if (
      !isValidMinuteBoundary(block.startMinute) ||
      !isValidMinuteBoundary(block.endMinute)
    ) {
      return "startMinute and endMinute must be valid 30-minute boundaries";
    }
    if (block.endMinute <= block.startMinute) {
      return "Each schedule block must have endMinute greater than startMinute";
    }

    for (const day of block.days) {
      if (!isMetaScheduleDay(day)) {
        return "scheduleBlocks days must use Meta day indexes from 0 to 6";
      }

      for (let minute = block.startMinute; minute < block.endMinute; minute += 30) {
        const slotKey = `${day}-${minute}`;
        if (occupiedSlots.has(slotKey)) {
          return "scheduleBlocks cannot overlap on the same day";
        }
        occupiedSlots.add(slotKey);
      }
    }
  }

  return null;
}

/**
 * Duplicate routes: request body → engine override. Absent `deliveryMode` = keep each ad
 * set's schedule. Blocks are snapped to Meta's whole-hour grid before they leave.
 */
export function scheduleOverrideFromRequest(body: {
  deliveryMode?: unknown;
  scheduleBlocks?: unknown;
}): { ok: true; override?: AdSetScheduleOverride } | { ok: false; message: string } {
  if (body.deliveryMode === undefined) return { ok: true };
  if (body.deliveryMode !== "all_day" && body.deliveryMode !== "specific_hours") {
    return { ok: false, message: "deliveryMode must be all_day or specific_hours" };
  }
  const blocks = Array.isArray(body.scheduleBlocks)
    ? (body.scheduleBlocks as CampaignScheduleBlock[])
    : undefined;
  const error = validateCampaignScheduleBlocks(
    body.deliveryMode,
    body.deliveryMode === "specific_hours" ? blocks : undefined,
  );
  if (error) return { ok: false, message: error };
  if (body.deliveryMode === "all_day") return { ok: true, override: { mode: "all_day" } };
  return {
    ok: true,
    override: {
      mode: "specific_hours",
      blocks: normalizeCampaignScheduleBlocksForMeta(blocks),
    },
  };
}

/** Human text for the duplication audit note. */
export function describeScheduleOverride(override: AdSetScheduleOverride): string {
  if (override.mode === "all_day") return "novo horário: o dia todo";
  const hhmm = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return `novo horário: ${override.blocks
    .map((block) => `dias ${block.days.join(",")} ${hhmm(block.startMinute)}–${hhmm(block.endMinute)}`)
    .join("; ")}`;
}

export function toMetaAdSetScheduleBlocks(
  blocks: CampaignScheduleBlock[] | undefined,
): MetaAdSetScheduleBlock[] {
  return normalizeCampaignScheduleBlocksForMeta(blocks).map((block) => ({
    days: block.days,
    start_minute: block.startMinute,
    end_minute: block.endMinute,
  }));
}

export function fromMetaAdSetScheduleBlocks(
  blocks: GraphAdSetScheduleBlock[] | undefined,
): CampaignScheduleBlock[] {
  if (!blocks) return [];

  return normalizeCampaignScheduleBlocks(
    blocks.flatMap((block) => {
      const startMinute = block.start_minute;
      const endMinute = block.end_minute;

      if (
        !Array.isArray(block.days) ||
        typeof startMinute !== "number" ||
        typeof endMinute !== "number" ||
        !Number.isInteger(startMinute) ||
        !Number.isInteger(endMinute) ||
        endMinute <= startMinute
      ) {
        return [];
      }

      const days = block.days.filter((day): day is MetaScheduleDay =>
        isMetaScheduleDay(day),
      );

      if (days.length === 0) return [];

      return [
        {
          days,
          startMinute,
          endMinute,
        },
      ];
    }),
  );
}

export function getDeliveryModeFromMetaAdSetSchedule(
  blocks: GraphAdSetScheduleBlock[] | undefined,
): CampaignDeliveryMode {
  // Campanha programada guarda "o dia todo" como grade de 24h x 7 (a Meta exige grade).
  if (isFullWeekSchedule(blocks)) return "all_day";
  return fromMetaAdSetScheduleBlocks(blocks).length > 0
    ? "specific_hours"
    : "all_day";
}

/** Valor do editor de horário a partir da grade lida da Meta (24h x 7 = o dia todo, sem blocos). */
export function deliveryScheduleFromMetaAdSetSchedule(
  blocks: GraphAdSetScheduleBlock[] | undefined,
): { deliveryMode: CampaignDeliveryMode; scheduleBlocks: CampaignScheduleBlock[] } {
  const deliveryMode = getDeliveryModeFromMetaAdSetSchedule(blocks);
  return {
    deliveryMode,
    scheduleBlocks: deliveryMode === "all_day" ? [] : fromMetaAdSetScheduleBlocks(blocks),
  };
}

export function areCampaignScheduleBlocksEqual(
  left: CampaignScheduleBlock[] | undefined,
  right: CampaignScheduleBlock[] | undefined,
): boolean {
  return (
    JSON.stringify(toMetaAdSetScheduleBlocks(left)) ===
    JSON.stringify(toMetaAdSetScheduleBlocks(right))
  );
}
