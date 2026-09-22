import {
  todayInBrazil,
  monthAfter,
  shiftDays,
} from "@/lib/ambassadors/workflow";
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import {
  crmContact,
  user,
  referralAffiliate,
  backofficeUser,
} from "@/lib/db/schema";
import {
  listCrmLeads,
  setCrmLeadStatus,
  getCrmLead,
} from "@/lib/db/crm-queries";
import { getCrmGoalsDashboard } from "@/lib/db/crm-goals-queries";
import { grantStarter } from "@/lib/ambassadors/benefits";
import { createAmbassador } from "@/lib/ambassadors/queries";
const enabled = process.env.RUN_AMBASSADOR_DB_TESTS === "1";
if (
  enabled &&
  process.env.POSTGRES_URL !==
    "postgres://codex@127.0.0.1:55439/automatize_test"
)
  throw new Error("Use the disposable local fixture database only.");
test(
  "CRM contact filters, signup association, monthly goals and gifted access separation",
  { skip: !enabled },
  async () => {
    const month = todayInBrazil().slice(0, 7);
    const expiresOn = `${Number(month.slice(0, 4)) + 1}-12-31`;
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `contact-${suffix}@restaurant.example`;
    const [contact] = await db
      .insert(crmContact)
      .values({
        email,
        name: "Contato comercial",
        phone: "+5511998765432",
        captureSource: "isaac",
        captureProfile: "gestor",
      })
      .returning();
    const list = await listCrmLeads({
      page: 1,
      pageSize: 10,
      captureSource: "isaac",
      captureProfile: "gestor",
      accountStage: "sem_conta",
      search: email,
      signup: {
        from: `${month}-01`,
        to: shiftDays(`${monthAfter(month)}-01`, -1),
      },
    });
    assert.equal(list.total, 1);
    assert.equal(list.leads[0].accountStage, "sem_conta");
    await setCrmLeadStatus({
      userId: contact.id,
      status: "reuniao_realizada",
      authorEmail: "admin@example.com",
    });
    const goals = await getCrmGoalsDashboard(month);
    const [account] = await db.insert(user).values({ email }).returning();
    const later = await getCrmGoalsDashboard(month);
    assert.equal(later.metrics[0].denominator, goals.metrics[0].denominator);
    assert.equal(later.metrics[1].numerator, goals.metrics[1].numerator);
    assert.equal((await getCrmLead(account.id))?.lead.id, contact.id);
    await setCrmLeadStatus({
      userId: account.id,
      status: "follow_up",
      authorEmail: "admin@example.com",
    });
    assert.equal(
      (await getCrmLead(contact.id))?.lead.commercialStatus,
      "follow_up",
    );

    const [owner] = await db
      .insert(backofficeUser)
      .values({ email: `crm-owner-${suffix}@example.com`, role: "admin" })
      .returning();
    const [affiliate] = await db
      .insert(referralAffiliate)
      .values({ userId: account.id, code: `crm-${suffix}`, status: "approved" })
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
    await grantStarter(record.id, expiresOn, owner.email);
    const gift = await listCrmLeads({
      page: 1,
      pageSize: 10,
      accountStage: "cortesia",
      search: email,
    });
    assert.equal((await getCrmLead(contact.id))?.lead.accountStage, "cortesia");
    assert.equal(gift.total, 1);
    assert.equal(gift.leads[0].accountStage, "cortesia");
    assert.equal(
      (
        await listCrmLeads({
          page: 1,
          pageSize: 10,
          accountStage: "trial_ativo",
          search: email,
        })
      ).total,
      0,
    );
    const giftedGoals = await getCrmGoalsDashboard(month);
    assert.equal(giftedGoals.metrics[1].numerator, later.metrics[1].numerator);
    assert.equal(giftedGoals.metrics[2].numerator, later.metrics[2].numerator);
  },
);
