import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { backofficeAuditLog, subscription, user, type PlanType } from "@/lib/db/schema";
import { createOrReuseBackofficeVindiPix } from "./backoffice-pix-charge";
import { createDbBackofficeVindiPixStore } from "./backoffice-pix-store";
import { getVindiPixMethodCode, isVindiSubscriptionsEnabled } from "./config";
import { createDbVindiCustomerDirectory } from "./customers";
import { createPrivateVindiClient } from "./private";

export async function createOrReuseBackofficeVindiPixForUser(input: {
  userId: string;
  planType: PlanType;
  adminEmail: string;
}) {
  const [targetUser] = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
    })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);
  if (!targetUser) {
    throw new Error("Usuário não encontrado.");
  }

  const subscriptions = await db
    .select({
      provider: subscription.provider,
      status: subscription.status,
    })
    .from(subscription)
    .where(
      and(
        eq(subscription.userId, input.userId),
        inArray(subscription.status, ["active", "trialing", "past_due"]),
      ),
    );

  const created = await createOrReuseBackofficeVindiPix({
    client: createPrivateVindiClient(),
    customers: createDbVindiCustomerDirectory(),
    store: createDbBackofficeVindiPixStore(),
    user: {
      id: targetUser.id,
      name: targetUser.name?.trim() || targetUser.email,
      email: targetUser.email,
    },
    subscriptions,
    planType: input.planType,
    pixMethodCode: getVindiPixMethodCode(),
    vindiSubscriptionsEnabled: isVindiSubscriptionsEnabled(),
    now: new Date(),
  });

  await db.insert(backofficeAuditLog).values({
    adminEmail: input.adminEmail,
    targetUserId: input.userId,
    action: created.reused ? "reuse_vindi_pix" : "generate_vindi_pix",
    fieldName: "vindi_payment_link",
    oldValue: null,
    newValue: created.link.id,
    note: created.reused
      ? `Pix Vindi reutilizado (${created.link.planType})`
      : `Pix Vindi gerado (${created.link.planType})`,
  });

  return created;
}
