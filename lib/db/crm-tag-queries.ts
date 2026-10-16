import { db } from "@/lib/db";
import { crmTagSetting } from "@/lib/db/schema";
import {
  crmTagInput,
  resolveCrmTags,
  type CrmTag,
} from "@/lib/backoffice/crm-tags";

export async function getCrmTags() {
  const rows = await db
    .select({
      key: crmTagSetting.key,
      name: crmTagSetting.name,
      color: crmTagSetting.color,
    })
    .from(crmTagSetting);
  return resolveCrmTags(rows);
}

export async function saveCrmTag(input: CrmTag, updatedBy: string) {
  const tag = crmTagInput.parse(input);
  await db
    .insert(crmTagSetting)
    .values({ ...tag, updatedBy })
    .onConflictDoUpdate({
      target: crmTagSetting.key,
      set: {
        name: tag.name,
        color: tag.color,
        updatedBy,
        updatedAt: new Date(),
      },
    });
  return getCrmTags();
}
