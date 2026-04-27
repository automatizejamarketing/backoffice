import { and, count, desc, eq, sum } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  affiliate,
  affiliateActionLog,
  affiliateClick,
  affiliateConversion,
  user,
  type Affiliate,
  type AffiliateActionType,
  type AffiliateConversion,
  type AffiliateConversionStatus,
} from "@/lib/db/schema";

export async function getAllAffiliates(
  filters?: { status?: string },
  limit = 50,
  offset = 0,
) {
  const conditions = [];
  if (filters?.status) {
    conditions.push(eq(affiliate.status, filters.status as Affiliate["status"]));
  }

  const query = db
    .select({
      id: affiliate.id,
      userId: affiliate.userId,
      code: affiliate.code,
      status: affiliate.status,
      commissionRate: affiliate.commissionRate,
      stripePromotionCodeId: affiliate.stripePromotionCodeId,
      approvedBy: affiliate.approvedBy,
      approvedAt: affiliate.approvedAt,
      rejectedBy: affiliate.rejectedBy,
      rejectedAt: affiliate.rejectedAt,
      rejectionReason: affiliate.rejectionReason,
      createdAt: affiliate.createdAt,
      updatedAt: affiliate.updatedAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image_url: user.image_url,
      },
    })
    .from(affiliate)
    .innerJoin(user, eq(affiliate.userId, user.id))
    .orderBy(desc(affiliate.createdAt))
    .limit(limit)
    .offset(offset);

  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }
  return query;
}

export async function getAffiliateById(affiliateId: string) {
  const [result] = await db
    .select({
      id: affiliate.id,
      userId: affiliate.userId,
      code: affiliate.code,
      status: affiliate.status,
      stripeCouponId: affiliate.stripeCouponId,
      stripePromotionCodeId: affiliate.stripePromotionCodeId,
      commissionRate: affiliate.commissionRate,
      approvedBy: affiliate.approvedBy,
      approvedAt: affiliate.approvedAt,
      rejectedBy: affiliate.rejectedBy,
      rejectedAt: affiliate.rejectedAt,
      rejectionReason: affiliate.rejectionReason,
      blockedBy: affiliate.blockedBy,
      blockedAt: affiliate.blockedAt,
      createdAt: affiliate.createdAt,
      updatedAt: affiliate.updatedAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image_url: user.image_url,
      },
    })
    .from(affiliate)
    .innerJoin(user, eq(affiliate.userId, user.id))
    .where(eq(affiliate.id, affiliateId))
    .limit(1);
  return result ?? null;
}

export async function getAffiliateMetrics(affiliateId: string) {
  const [clicks] = await db
    .select({ total: count() })
    .from(affiliateClick)
    .where(eq(affiliateClick.affiliateId, affiliateId));

  const [conversions] = await db
    .select({ total: count() })
    .from(affiliateConversion)
    .where(eq(affiliateConversion.affiliateId, affiliateId));

  const [revenue] = await db
    .select({ total: sum(affiliateConversion.amount) })
    .from(affiliateConversion)
    .where(eq(affiliateConversion.affiliateId, affiliateId));

  const [commissionTotal] = await db
    .select({ total: sum(affiliateConversion.commissionAmount) })
    .from(affiliateConversion)
    .where(eq(affiliateConversion.affiliateId, affiliateId));

  const [commissionPaid] = await db
    .select({ total: sum(affiliateConversion.commissionAmount) })
    .from(affiliateConversion)
    .where(
      and(
        eq(affiliateConversion.affiliateId, affiliateId),
        eq(affiliateConversion.status, "paid"),
      ),
    );

  return {
    clicks: clicks?.total ?? 0,
    conversions: conversions?.total ?? 0,
    revenue: Number(revenue?.total ?? 0),
    commissionTotal: Number(commissionTotal?.total ?? 0),
    commissionPaid: Number(commissionPaid?.total ?? 0),
  };
}

export async function getAffiliateConversions(affiliateId: string) {
  return db
    .select({
      id: affiliateConversion.id,
      amount: affiliateConversion.amount,
      commissionAmount: affiliateConversion.commissionAmount,
      currency: affiliateConversion.currency,
      status: affiliateConversion.status,
      stripeInvoiceId: affiliateConversion.stripeInvoiceId,
      approvedAt: affiliateConversion.approvedAt,
      paidAt: affiliateConversion.paidAt,
      createdAt: affiliateConversion.createdAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    })
    .from(affiliateConversion)
    .innerJoin(user, eq(affiliateConversion.convertedUserId, user.id))
    .where(eq(affiliateConversion.affiliateId, affiliateId))
    .orderBy(desc(affiliateConversion.createdAt));
}

export async function approveAffiliate(
  affiliateId: string,
  adminEmail: string,
  stripePromotionCodeId: string,
  stripeCouponId: string,
) {
  await db
    .update(affiliate)
    .set({
      status: "approved",
      approvedBy: adminEmail,
      approvedAt: new Date(),
      stripePromotionCodeId,
      stripeCouponId,
      updatedAt: new Date(),
    })
    .where(eq(affiliate.id, affiliateId));
}

export async function rejectAffiliate(
  affiliateId: string,
  adminEmail: string,
  reason: string,
) {
  await db
    .update(affiliate)
    .set({
      status: "rejected",
      rejectedBy: adminEmail,
      rejectedAt: new Date(),
      rejectionReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(affiliate.id, affiliateId));
}

export async function createAffiliateForUser(
  userId: string,
  code: string,
  adminEmail: string,
  stripePromotionCodeId: string,
  stripeCouponId: string,
): Promise<Affiliate> {
  const [result] = await db
    .insert(affiliate)
    .values({
      userId,
      code,
      status: "approved",
      approvedBy: adminEmail,
      approvedAt: new Date(),
      stripePromotionCodeId,
      stripeCouponId,
    })
    .returning();
  return result;
}

export async function updateConversionStatus(
  conversionId: string,
  status: AffiliateConversionStatus,
) {
  const updates: Record<string, unknown> = { status };
  if (status === "paid") {
    updates.paidAt = new Date();
  }
  if (status === "approved") {
    updates.approvedAt = new Date();
  }

  await db
    .update(affiliateConversion)
    .set(updates)
    .where(eq(affiliateConversion.id, conversionId));
}

export function generateAffiliateCode(name: string): string {
  const prefix = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 6)
    .toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix || "AFF"}_${suffix}`;
}

export async function updateAffiliateCode(
  affiliateId: string,
  newCode: string,
) {
  await db
    .update(affiliate)
    .set({ code: newCode, updatedAt: new Date() })
    .where(eq(affiliate.id, affiliateId));
}

export async function blockAffiliate(
  affiliateId: string,
  adminEmail: string,
) {
  await db
    .update(affiliate)
    .set({
      status: "blocked",
      blockedBy: adminEmail,
      blockedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(affiliate.id, affiliateId));
}

export async function reactivateAffiliate(
  affiliateId: string,
  adminEmail: string,
) {
  await db
    .update(affiliate)
    .set({
      status: "approved",
      blockedBy: null,
      blockedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(affiliate.id, affiliateId));
}

export async function createAffiliateActionLog(
  affiliateId: string,
  adminEmail: string,
  action: AffiliateActionType,
  details?: Record<string, unknown>,
) {
  await db.insert(affiliateActionLog).values({
    affiliateId,
    adminEmail,
    action,
    details: details ?? null,
  });
}

export async function getAffiliateActionLogs(affiliateId: string) {
  return db
    .select({
      id: affiliateActionLog.id,
      adminEmail: affiliateActionLog.adminEmail,
      action: affiliateActionLog.action,
      details: affiliateActionLog.details,
      createdAt: affiliateActionLog.createdAt,
    })
    .from(affiliateActionLog)
    .where(eq(affiliateActionLog.affiliateId, affiliateId))
    .orderBy(desc(affiliateActionLog.createdAt));
}
