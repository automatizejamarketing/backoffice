import { test } from "node:test";
import assert from "node:assert/strict";
// Opt-in only: the suite writes to a disposable local database seeded from main.
const enabled = process.env.RUN_AMBASSADOR_DB_TESTS === "1";
if (
  enabled &&
  !/^postgres:\/\/codex@127\.0\.0\.1:55439\/automatize_test$/.test(
    process.env.POSTGRES_URL ?? "",
  )
)
  throw new Error("Use the disposable local fixture database only.");
test(
  "grant concurrency, expiry extension, lapsed renewal, monthly idempotency, ended partnership, billing separation",
  { skip: !enabled },
  async () => {
    const { db } = await import("@/lib/db");
    const {
      ambassadorBenefit,
      ambassadorEvent,
      ambassadorCreditGrant,
      backofficeUser,
      creditTransaction,
      referralAffiliate,
      subscription,
      user,
    } = await import("@/lib/db/schema");
    const { eq, sql } = await import("drizzle-orm");
    const { grantStarter, maintainAmbassadors } = await import("./benefits");
    const { createAmbassador, updateAmbassador } = await import("./queries");
    const suffix = crypto.randomUUID();
    const [owner] = await db
      .insert(backofficeUser)
      .values({
        email: `owner-${suffix}@example.com`,
        name: "Responsável",
        role: "admin",
      })
      .returning();
    const [account] = await db
      .insert(user)
      .values({ email: `a-${suffix.slice(0, 8)}@example.com` })
      .returning();
    const [affiliate] = await db
      .insert(referralAffiliate)
      .values({
        userId: account.id,
        code: suffix.slice(0, 20),
        status: "approved",
      })
      .returning();
    const record = await createAmbassador(
      {
        affiliateId: affiliate.id,
        category: "ambassador",
        publicityOwnerId: owner.id,
        coproductionOwnerId: null,
      },
      owner.email,
    );
    await Promise.all(
      Array.from({ length: 5 }, () =>
        grantStarter(record.id, "2026-03-31", owner.email, "2026-01-31"),
      ),
    );
    const read = async () =>
      (await db.select().from(user).where(eq(user.id, account.id)))[0];
    assert.equal((await read()).credits, 250);
    await grantStarter(record.id, "2026-04-30", owner.email, "2026-02-01");
    assert.equal((await read()).credits, 250);
    await Promise.all([
      maintainAmbassadors("2026-02-28"),
      maintainAmbassadors("2026-02-28"),
    ]);
    assert.equal((await read()).credits, 500);
    await maintainAmbassadors("2026-05-20");
    assert.equal((await read()).credits, 1000); // March and April valid cycles caught up.
    await grantStarter(record.id, "2026-08-31", owner.email, "2026-06-15");
    assert.equal((await read()).credits, 1000); // May expired: no retroactive refill.
    const [benefit] = await db
      .select()
      .from(ambassadorBenefit)
      .where(eq(ambassadorBenefit.ambassadorId, record.id));
    assert.equal(benefit.nextCreditOn, "2026-06-30");
    assert.equal(benefit.anchorOn, "2026-01-31");
    await updateAmbassador(
      record.id,
      { action: "end", version: 0 },
      owner.email,
    );
    await maintainAmbassadors("2026-06-30");
    assert.equal((await read()).credits, 1250); // Ending leaves awarded benefit intact.
    assert.equal(
      (
        await db
          .select()
          .from(subscription)
          .where(eq(subscription.userId, account.id))
      ).length,
      0,
    );
    const payments = await db.execute(
      sql`select count(*)::int n from payments where user_id=${account.id}`,
    );
    assert.equal(payments[0].n, 0);
    const ledger = await db
      .select()
      .from(ambassadorCreditGrant)
      .where(eq(ambassadorCreditGrant.ambassadorId, record.id));
    assert.equal(ledger.length, 5);
    const transactions = await db
      .select()
      .from(creditTransaction)
      .where(eq(creditTransaction.userId, account.id));
    assert.equal(transactions.length, 5);
    await assert.rejects(
      grantStarter(record.id, "2026-09-30", owner.email, "2026-07-01"),
      /encerrada/,
    );
    const [paidAccount] = await db
      .insert(user)
      .values({ email: `p-${suffix.slice(0, 8)}@example.com` })
      .returning();
    const [paidAffiliate] = await db
      .insert(referralAffiliate)
      .values({
        userId: paidAccount.id,
        code: `p-${suffix.slice(0, 20)}`,
        status: "approved",
      })
      .returning();
    const paidRecord = await createAmbassador(
      {
        affiliateId: paidAffiliate.id,
        category: "ambassador",
        publicityOwnerId: owner.id,
        coproductionOwnerId: null,
      },
      owner.email,
    );
    await db.insert(subscription).values({
      userId: paidAccount.id,
      provider: "stripe",
      planType: "monthly_starter",
      status: "active",
    });
    await assert.rejects(
      grantStarter(paidRecord.id, "2026-12-31", owner.email, "2026-09-22"),
      /assinatura ativa/,
    );
    assert.equal(
      (
        await db
          .select()
          .from(ambassadorBenefit)
          .where(eq(ambassadorBenefit.ambassadorId, paidRecord.id))
      ).length,
      0,
    );
    const event = (
      await db
        .select()
        .from(ambassadorEvent)
        .where(eq(ambassadorEvent.ambassadorId, record.id))
    )[0];
    assert.ok(event.authorEmail);
  },
);
