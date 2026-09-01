import { db } from "./index";
import { 
  radarSearchConfigurations, 
  radarCollectionRuns, 
  radarContents, 
  radarContentSnapshots 
} from "./schema";
import { eq, desc, and, or, sql, inArray } from "drizzle-orm";

export async function getActiveRadarConfigurations() {
  return db
    .select()
    .from(radarSearchConfigurations)
    .where(eq(radarSearchConfigurations.isActive, true));
}

export async function getRadarConfigurationById(id: string) {
  const result = await db
    .select()
    .from(radarSearchConfigurations)
    .where(eq(radarSearchConfigurations.id, id))
    .limit(1);
  return result[0];
}

export async function createRadarCollectionRun(data: typeof radarCollectionRuns.$inferInsert) {
  const result = await db.insert(radarCollectionRuns).values(data).returning();
  return result[0];
}

export async function updateRadarCollectionRun(id: string, data: Partial<typeof radarCollectionRuns.$inferInsert>) {
  const result = await db.update(radarCollectionRuns).set(data).where(eq(radarCollectionRuns.id, id)).returning();
  return result[0];
}

export async function upsertRadarContent(content: typeof radarContents.$inferInsert) {
  // Try to find existing
  const existing = await db
    .select()
    .from(radarContents)
    .where(
      and(
        eq(radarContents.platform, content.platform),
        eq(radarContents.externalId, content.externalId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    const updated = await db
      .update(radarContents)
      .set({
        ...content,
        lastUpdatedAt: new Date(),
      })
      .where(eq(radarContents.id, existing[0].id))
      .returning();
    return { content: updated[0], isNew: false };
  } else {
    const inserted = await db.insert(radarContents).values(content).returning();
    return { content: inserted[0], isNew: true };
  }
}

export async function addRadarContentSnapshot(snapshot: typeof radarContentSnapshots.$inferInsert) {
  const result = await db.insert(radarContentSnapshots).values(snapshot).returning();
  return result[0];
}

export async function updateConfigurationNextRun(id: string, nextRunAt: Date) {
  await db.update(radarSearchConfigurations).set({ nextRunAt, lastRunAt: new Date() }).where(eq(radarSearchConfigurations.id, id));
}
