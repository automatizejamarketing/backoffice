import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  ambassador,
  ambassadorBenefit,
  ambassadorCreditGrant,
  ambassadorEvent,
  creditTransaction,
  referralAffiliate,
  subscription,
  user,
} from "@/lib/db/schema";
import {
  isDate,
  nextCreditDate,
  refreshWorkflow,
  todayInBrazil,
} from "./workflow";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function grantCredits(
  tx: Transaction,
  benefit: typeof ambassadorBenefit.$inferSelect,
  cycleOn: string,
) {
  const [inserted] = await tx
    .insert(ambassadorCreditGrant)
    .values({ ambassadorId: benefit.ambassadorId, cycleOn })
    .onConflictDoNothing()
    .returning();
  if (!inserted) return;
  await tx
    .update(user)
    .set({ credits: sql`${user.credits} + 250` })
    .where(eq(user.id, benefit.userId));
  await tx.insert(creditTransaction).values({
    userId: benefit.userId,
    amount: 250,
    type: "ambassador_benefit",
    description: "Créditos do benefício Starter de embaixador",
    metadata: { ambassadorId: benefit.ambassadorId, cycleOn },
  });
}

/** Caller must hold the ambassador lock. No subscription/payment is manufactured. */
async function settleCredits(
  tx: Transaction,
  benefit: typeof ambassadorBenefit.$inferSelect,
  today: string,
) {
  let next = benefit.nextCreditOn;
  while (next <= today && next <= benefit.expiresOn) {
    await grantCredits(tx, benefit, next);
    next = nextCreditDate(benefit.anchorOn, next);
  }
  if (next !== benefit.nextCreditOn)
    await tx
      .update(ambassadorBenefit)
      .set({ nextCreditOn: next, updatedAt: new Date() })
      .where(eq(ambassadorBenefit.ambassadorId, benefit.ambassadorId));
  return next;
}

export async function grantStarter(
  id: string,
  expiresOn: string,
  authorEmail: string,
  today = todayInBrazil(),
) {
  if (!isDate(expiresOn) || expiresOn < today)
    throw new Error("Escolha um vencimento a partir de hoje.");
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(ambassador)
      .where(eq(ambassador.id, id))
      .for("update");
    if (!record?.active)
      throw new Error("Embaixador não encontrado ou parceria encerrada.");
    const [affiliate] = await tx
      .select()
      .from(referralAffiliate)
      .where(eq(referralAffiliate.id, record.affiliateId));
    const [account] = await tx
      .select()
      .from(user)
      .where(eq(user.id, affiliate.userId))
      .for("update");
    const [paid] = await tx
      .select({ id: subscription.id })
      .from(subscription)
      .where(
        and(
          eq(subscription.userId, account.id),
          inArray(subscription.status, ["active", "trialing", "past_due"]),
        ),
      )
      .limit(1);
    if (paid)
      throw new Error(
        "Há uma assinatura ativa. Um administrador deve revisar a assinatura antes de liberar o benefício.",
      );
    const [previous] = await tx
      .select()
      .from(ambassadorBenefit)
      .where(eq(ambassadorBenefit.ambassadorId, id));
    if (previous && expiresOn < previous.expiresOn)
      throw new Error(
        "O benefício pode ser prorrogado; seu vencimento não pode ser antecipado.",
      );
    let nextCreditOn = previous
      ? await settleCredits(tx, previous, today)
      : nextCreditDate(today, today);
    // After a lapse, keep the original anchor and skip only periods without coverage.
    if (previous && previous.expiresOn < today)
      nextCreditOn = nextCreditDate(previous.anchorOn, today);
    const benefit = {
      ambassadorId: id,
      userId: account.id,
      anchorOn: previous?.anchorOn ?? today,
      expiresOn,
      nextCreditOn,
      updatedAt: new Date(),
    };
    await tx
      .insert(ambassadorBenefit)
      .values(benefit)
      .onConflictDoUpdate({
        target: ambassadorBenefit.ambassadorId,
        set: { expiresOn, nextCreditOn, updatedAt: new Date() },
      });
    if (!previous) await grantCredits(tx, benefit, today);
    const accessEnd = new Date(`${expiresOn}T23:59:59.999-03:00`);
    await tx
      .update(user)
      .set({
        expirationDate: sql`greatest(${user.expirationDate}, ${accessEnd.toISOString()}::timestamptz)`,
      })
      .where(eq(user.id, account.id));
    await tx.insert(ambassadorEvent).values({
      ambassadorId: id,
      authorEmail,
      action: "starter",
      details: {
        previousExpiresOn: previous?.expiresOn ?? null,
        expiresOn,
        anchorOn: benefit.anchorOn,
        initialCredits: !previous,
      },
    });
    return benefit;
  });
}

/** Daily durable catch-up; row locks + unique cycle ledger make retries safe. */
export async function maintainAmbassadors(today = todayInBrazil()) {
  const rows = await db.select({ id: ambassador.id }).from(ambassador);
  for (const { id } of rows)
    await db.transaction(async (tx) => {
      const [record] = await tx
        .select()
        .from(ambassador)
        .where(eq(ambassador.id, id))
        .for("update");
      const workflow = structuredClone(record.workflow);
      refreshWorkflow(workflow, today, record.active);
      if (JSON.stringify(workflow) !== JSON.stringify(record.workflow))
        await tx
          .update(ambassador)
          .set({ workflow, version: record.version + 1, updatedAt: new Date() })
          .where(eq(ambassador.id, id));
      const [benefit] = await tx
        .select()
        .from(ambassadorBenefit)
        .where(
          and(
            eq(ambassadorBenefit.ambassadorId, id),
            lte(ambassadorBenefit.nextCreditOn, today),
          ),
        );
      if (benefit) await settleCredits(tx, benefit, today);
    });
  return { checked: rows.length };
}
