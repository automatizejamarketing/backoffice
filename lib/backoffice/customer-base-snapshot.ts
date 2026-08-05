import { eq } from "drizzle-orm";
import { formatBrtCalendarDate } from "@/lib/backoffice/dashboard-date-range";
import { summarizeCustomerBaseStatus } from "@/lib/backoffice/customer-base-status";
import { fetchCustomerBaseRows } from "@/lib/db/admin-queries";
import { db } from "@/lib/db/index";
import { customerBaseDailySnapshot } from "@/lib/db/schema";

export type CaptureCustomerBaseDailySnapshotResult = {
  snapshotDate: string;
  inserted: boolean;
  status: ReturnType<typeof summarizeCustomerBaseStatus>;
};

export async function captureCustomerBaseDailySnapshot(
  referenceDate: Date = new Date(),
): Promise<CaptureCustomerBaseDailySnapshotResult> {
  const snapshotDate = formatBrtCalendarDate(referenceDate);
  const customerRows = await fetchCustomerBaseRows();
  const status = summarizeCustomerBaseStatus(customerRows, referenceDate);

  const values = {
    snapshotDate,
    activePaying: status.activePaying,
    trial: status.trial,
    churnTotal: status.churn.total,
    churnCard: status.churn.card,
    churnPix: status.churn.pix,
    scheduledCancel: status.scheduledCancel,
    updatedAt: new Date(),
  };

  const [existing] = await db
    .select({ id: customerBaseDailySnapshot.id })
    .from(customerBaseDailySnapshot)
    .where(eq(customerBaseDailySnapshot.snapshotDate, snapshotDate))
    .limit(1);

  if (existing) {
    await db
      .update(customerBaseDailySnapshot)
      .set(values)
      .where(eq(customerBaseDailySnapshot.id, existing.id));

    return {
      snapshotDate,
      inserted: false,
      status,
    };
  }

  await db.insert(customerBaseDailySnapshot).values(values);

  return {
    snapshotDate,
    inserted: true,
    status,
  };
}
