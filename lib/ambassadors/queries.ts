import { z } from "zod";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  ambassador,
  ambassadorBenefit,
  ambassadorEvent,
  ambassadorMember,
  backofficeUser,
  referralAffiliate,
  user,
} from "@/lib/db/schema";
import {
  changeTask,
  newWorkflow,
  refreshWorkflow,
  taskChangeSchema,
  todayInBrazil,
} from "./workflow";

const category = z.enum(["ambassador", "coproducer"]);
const owners = {
  publicityOwnerId: z.string().uuid(),
  coproductionOwnerId: z.string().uuid().nullable(),
};
export const createSchema = z
  .object({ affiliateId: z.string().uuid(), category, ...owners })
  .strict();
export const updateSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("task"),
      version: z.number().int().nonnegative(),
      change: taskChangeSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("details"),
      version: z.number().int().nonnegative(),
      category,
      ...owners,
    })
    .strict(),
  z
    .object({
      action: z.literal("end"),
      version: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal("note"),
      body: z.string().trim().min(1).max(5000),
    })
    .strict(),
]);
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function validateOwners(
  tx: Tx,
  data:
    | z.infer<typeof createSchema>
    | Extract<z.infer<typeof updateSchema>, { action: "details" }>,
) {
  if (data.category === "coproducer" && !data.coproductionOwnerId)
    throw new Error("Escolha o responsável pela coprodução.");
  for (const id of new Set(
    [data.publicityOwnerId, data.coproductionOwnerId].filter(Boolean),
  )) {
    const [owner] = await tx
      .select({
        role: backofficeUser.role,
        active: backofficeUser.active,
        member: ambassadorMember.userId,
      })
      .from(backofficeUser)
      .leftJoin(
        ambassadorMember,
        eq(ambassadorMember.userId, backofficeUser.id),
      )
      .where(eq(backofficeUser.id, id!));
    if (!owner?.active || (owner.role !== "admin" && !owner.member))
      throw new Error(
        "O responsável precisa ter acesso ativo à aba de embaixadores.",
      );
  }
}

export async function listAmbassadors() {
  const rows = await db
    .select({
      record: ambassador,
      benefit: ambassadorBenefit,
      name: user.name,
      email: user.email,
      userId: user.id,
      paid: sql<boolean>`exists(select 1 from subscriptions s where s.user_id = ${user.id} and s.status in ('active','past_due','trialing'))`,
    })
    .from(ambassador)
    .innerJoin(
      referralAffiliate,
      eq(referralAffiliate.id, ambassador.affiliateId),
    )
    .innerJoin(user, eq(user.id, referralAffiliate.userId))
    .leftJoin(
      ambassadorBenefit,
      eq(ambassadorBenefit.ambassadorId, ambassador.id),
    )
    .orderBy(desc(ambassador.createdAt));
  // Read projection is current even before the daily maintenance runs.
  return rows.map((row) => {
    refreshWorkflow(row.record.workflow, todayInBrazil(), row.record.active);
    return row;
  });
}
export async function ambassadorOptions(includeTeam = false) {
  const [affiliates, team] = await Promise.all([
    db
      .select({
        id: referralAffiliate.id,
        name: user.name,
        email: user.email,
        status: referralAffiliate.status,
      })
      .from(referralAffiliate)
      .innerJoin(user, eq(user.id, referralAffiliate.userId))
      .leftJoin(ambassador, eq(ambassador.affiliateId, referralAffiliate.id))
      .where(isNull(ambassador.id))
      .orderBy(user.name),
    db
      .select({
        id: backofficeUser.id,
        name: backofficeUser.name,
        email: backofficeUser.email,
        role: backofficeUser.role,
        member: ambassadorMember.userId,
        canGrantStarter: ambassadorMember.canGrantStarter,
      })
      .from(backofficeUser)
      .leftJoin(
        ambassadorMember,
        eq(ambassadorMember.userId, backofficeUser.id),
      )
      .where(
        and(
          eq(backofficeUser.active, true),
          includeTeam
            ? undefined
            : or(
                eq(backofficeUser.role, "admin"),
                sql`${ambassadorMember.userId} is not null`,
              ),
        ),
      )
      .orderBy(backofficeUser.name),
  ]);
  return { affiliates, team };
}
export async function createAmbassador(
  data: z.infer<typeof createSchema>,
  authorEmail: string,
) {
  return db.transaction(async (tx) => {
    await validateOwners(tx, data);
    const [affiliate] = await tx
      .select()
      .from(referralAffiliate)
      .where(eq(referralAffiliate.id, data.affiliateId));
    if (!affiliate) throw new Error("Afiliado não encontrado.");
    const [created] = await tx
      .insert(ambassador)
      .values({ ...data, workflow: newWorkflow() })
      .onConflictDoNothing()
      .returning();
    if (!created)
      throw new Error("Este afiliado já foi adicionado aos embaixadores.");
    await tx.insert(ambassadorEvent).values({
      ambassadorId: created.id,
      authorEmail,
      action: "created",
      details: data,
    });
    return created;
  });
}
export async function updateAmbassador(
  id: string,
  data: z.infer<typeof updateSchema>,
  authorEmail: string,
) {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(ambassador)
      .where(eq(ambassador.id, id))
      .for("update");
    if (!record) throw new Error("Embaixador não encontrado.");
    if (data.action === "note") {
      await tx.insert(ambassadorEvent).values({
        ambassadorId: id,
        authorEmail,
        action: "note",
        details: { body: data.body },
      });
      return;
    }
    if (record.version !== data.version)
      throw new Error(
        "Esta ficha mudou. Atualize a página antes de salvar novamente.",
      );
    if (!record.active) throw new Error("Esta parceria está encerrada.");
    const workflow = structuredClone(record.workflow);
    refreshWorkflow(workflow, todayInBrazil(), record.active);
    const values: Partial<typeof ambassador.$inferInsert> = {
      version: record.version + 1,
      updatedAt: new Date(),
    };
    if (data.action === "task")
      values.workflow = changeTask(
        workflow,
        data.change,
        todayInBrazil(),
        record.category,
        record.active,
      );
    if (data.action === "details") {
      await validateOwners(tx, data);
      Object.assign(values, {
        category: data.category,
        publicityOwnerId: data.publicityOwnerId,
        coproductionOwnerId: data.coproductionOwnerId,
      });
    }
    if (data.action === "end")
      Object.assign(values, { active: false, endedAt: new Date(), workflow });
    await tx.update(ambassador).set(values).where(eq(ambassador.id, id));
    await tx.insert(ambassadorEvent).values({
      ambassadorId: id,
      authorEmail,
      action: data.action,
      details: {
        ...data,
        ...(data.action === "task"
          ? {
              change: {
                ...data.change,
                date:
                  data.change.operation === "reopen"
                    ? undefined
                    : (data.change.date ?? todayInBrazil()),
              },
            }
          : {}),
        previous:
          data.action === "task"
            ? record.workflow
            : {
                category: record.category,
                publicityOwnerId: record.publicityOwnerId,
                coproductionOwnerId: record.coproductionOwnerId,
              },
      },
    });
  });
}
export async function ambassadorHistory(id: string) {
  return db
    .select()
    .from(ambassadorEvent)
    .where(eq(ambassadorEvent.ambassadorId, id))
    .orderBy(desc(ambassadorEvent.createdAt));
}
