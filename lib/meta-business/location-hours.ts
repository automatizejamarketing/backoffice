import {
  normalizeCampaignScheduleBlocks,
  type CampaignDeliveryMode,
  type CampaignScheduleBlock,
} from "@/lib/meta-business/campaign-schedule";
import type { CompanyLocationHours } from "@/lib/db/company-location-queries";

const MINUTES_PER_HOUR = 60;

function snapBlocksToHourGrid(
  blocks: CampaignScheduleBlock[] | undefined,
): CampaignScheduleBlock[] {
  const snapped = normalizeCampaignScheduleBlocks(blocks).flatMap((block) => {
    const startMinute =
      Math.ceil(block.startMinute / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
    const endMinute =
      Math.floor(block.endMinute / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
    if (endMinute <= startMinute) return [];
    return [{ days: block.days, startMinute, endMinute }];
  });
  return normalizeCampaignScheduleBlocks(snapped);
}

export function parseLocationHours(
  value: unknown,
): CompanyLocationHours | null {
  if (!value || typeof value !== "object") return null;
  return value as CompanyLocationHours;
}

export function locationHasOperatingHours(value: unknown): boolean {
  const hours = parseLocationHours(value);
  if (!hours) return false;
  if (hours.deliveryMode === "all_day") return true;
  return (hours.scheduleBlocks?.length ?? 0) > 0;
}

export function scheduleFromLocationHours(value: unknown): {
  deliveryMode: CampaignDeliveryMode;
  scheduleBlocks: CampaignScheduleBlock[];
} | null {
  const hours = parseLocationHours(value);
  if (!hours) return null;

  if (hours.deliveryMode === "all_day") {
    return { deliveryMode: "all_day", scheduleBlocks: [] };
  }

  const scheduleBlocks = snapBlocksToHourGrid(
    (hours.scheduleBlocks ?? []).filter(
      (block) =>
        Array.isArray(block.days) &&
        block.days.length > 0 &&
        Number.isFinite(block.startMinute) &&
        Number.isFinite(block.endMinute) &&
        block.endMinute > block.startMinute,
    ) as CampaignScheduleBlock[],
  );

  if (scheduleBlocks.length === 0) return null;
  return { deliveryMode: "specific_hours", scheduleBlocks };
}
