import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  backofficeAuditLog,
  expertProfile,
  user,
  type VindiAffiliateStatus,
} from "@/lib/db/schema";
import { ensureVindiAffiliate } from "@/lib/vindi/affiliate";
import type { VindiClient } from "@/lib/vindi/client";
import { createPrivateVindiClient } from "@/lib/vindi/private";

export type ExpertVindiAffiliate = {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  vindiAffiliateId: string | null;
  vindiAffiliateStatus: VindiAffiliateStatus;
};

export async function ensureExpertVindiAffiliate(input: {
  expertId: string;
  adminEmail: string;
  client?: VindiClient;
}): Promise<ExpertVindiAffiliate> {
  const [expert] = await db
    .select({
      id: expertProfile.id,
      userId: expertProfile.userId,
      email: user.email,
      displayName: expertProfile.displayName,
      vindiAffiliateId: expertProfile.vindiAffiliateId,
      vindiAffiliateStatus: expertProfile.vindiAffiliateStatus,
    })
    .from(expertProfile)
    .innerJoin(user, eq(expertProfile.userId, user.id))
    .where(eq(expertProfile.id, input.expertId))
    .limit(1);
  if (!expert) {
    throw new Error("Expert não encontrado");
  }

  const ensured = await ensureVindiAffiliate(
    input.client ?? createPrivateVindiClient(),
    {
      login: expert.email,
      existingAffiliateId: expert.vindiAffiliateId,
    },
  );

  const [updated] = await db
    .update(expertProfile)
    .set({
      vindiAffiliateId: ensured.affiliateId,
      vindiAffiliateStatus: ensured.status,
      updatedAt: new Date(),
    })
    .where(eq(expertProfile.id, expert.id))
    .returning({
      id: expertProfile.id,
      userId: expertProfile.userId,
      displayName: expertProfile.displayName,
      vindiAffiliateId: expertProfile.vindiAffiliateId,
      vindiAffiliateStatus: expertProfile.vindiAffiliateStatus,
    });
  if (!updated) {
    throw new Error("não foi possível gravar o afiliado Vindi do expert");
  }

  if (
    expert.vindiAffiliateId !== updated.vindiAffiliateId ||
    expert.vindiAffiliateStatus !== updated.vindiAffiliateStatus
  ) {
    await db.insert(backofficeAuditLog).values({
      adminEmail: input.adminEmail,
      targetUserId: expert.userId,
      action: expert.vindiAffiliateId
        ? "refresh_vindi_affiliate"
        : "create_vindi_affiliate",
      fieldName: "vindi_affiliate_status",
      oldValue: expert.vindiAffiliateId
        ? `${expert.vindiAffiliateId}:${expert.vindiAffiliateStatus}`
        : null,
      newValue: `${updated.vindiAffiliateId}:${updated.vindiAffiliateStatus}`,
      note: `expert:${expert.id}`,
    });
  }

  return {
    ...updated,
    email: expert.email,
  };
}
