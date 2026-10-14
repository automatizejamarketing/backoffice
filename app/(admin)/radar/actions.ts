"use server";

import { requireBackofficePermission } from "@/lib/auth/rbac";
import { executeRadarConfiguration } from "@/lib/radar/radar-service";
import { revalidatePath } from "next/cache";

export async function executeRadarConfigurationAction(configId: string) {
  // Server action é endpoint público: a mesma permissão da página do Radar.
  await requireBackofficePermission("posts:manage");
  const result = await executeRadarConfiguration(configId, undefined, true);
  revalidatePath("/radar");
  return result;
}
