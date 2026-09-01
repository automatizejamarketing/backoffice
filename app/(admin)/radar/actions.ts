"use server";

import { executeRadarConfiguration } from "@/lib/radar/radar-service";
import { revalidatePath } from "next/cache";

export async function executeRadarConfigurationAction(configId: string) {
  const result = await executeRadarConfiguration(configId, undefined, true);
  revalidatePath("/radar");
  return result;
}
