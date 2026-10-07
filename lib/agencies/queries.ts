import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { BackofficeActor } from "@/lib/auth/rbac-core";
import { db } from "@/lib/db";
import { agency, agencyInvitation, agencyMember, user } from "@/lib/db/schema";
import {
  createInvitationToken,
  invitationExpiresAt,
  normalizeInvitationEmail,
} from "./invitation-token";

export type AgencyRow = {
  id: string;
  name: string;
  createdAt: Date;
  owners: string[];
  memberCount: number;
  pendingOwnerInvitation: { email: string; expiresAt: Date } | null;
};

export async function listAgencies(now = new Date()): Promise<AgencyRow[]> {
  const agencies = await db
    .select({ id: agency.id, name: agency.name, createdAt: agency.createdAt })
    .from(agency)
    .where(isNull(agency.archivedAt))
    .orderBy(desc(agency.createdAt));
  if (agencies.length === 0) return [];
  const ids = agencies.map((item) => item.id);

  const [members, invitations] = await Promise.all([
    db
      .select({ agencyId: agencyMember.agencyId, role: agencyMember.role, email: user.email })
      .from(agencyMember)
      .innerJoin(user, eq(user.id, agencyMember.userId))
      .where(inArray(agencyMember.agencyId, ids)),
    db
      .select({
        agencyId: agencyInvitation.agencyId,
        email: agencyInvitation.email,
        expiresAt: agencyInvitation.expiresAt,
      })
      .from(agencyInvitation)
      .where(
        and(
          inArray(agencyInvitation.agencyId, ids),
          eq(agencyInvitation.role, "owner"),
          isNull(agencyInvitation.acceptedAt),
          isNull(agencyInvitation.revokedAt),
          gt(agencyInvitation.expiresAt, now),
        ),
      )
      .orderBy(asc(agencyInvitation.createdAt)),
  ]);

  return agencies.map((item) => {
    const own = members.filter((member) => member.agencyId === item.id);
    const pending = invitations.filter((invitation) => invitation.agencyId === item.id).at(-1);
    return {
      ...item,
      owners: own.filter((member) => member.role === "owner").map((member) => member.email),
      memberCount: own.length,
      pendingOwnerInvitation: pending ? { email: pending.email, expiresAt: pending.expiresAt } : null,
    };
  });
}

type InviteResult =
  | { ok: true; agencyId: string; token: string; email: string; expiresAt: Date }
  | { ok: false; error: "invalid_email" | "invalid_name" | "agency_not_found" };

/** Só um usuário de `backoffice_users` vira autor; o fallback por e-mail não tem linha. */
function inviterId(actor: BackofficeActor): string | null {
  return actor.source === "database" ? actor.id : null;
}

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Mesma trava de equipe do frontend (`lib/agency/agencies.ts`): convites e
 * aceites de uma Agência ficam serializados entre os dois apps.
 */
async function lockAgency(tx: Executor, agencyId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('agency:' || ${agencyId}::uuid::text, 0))`,
  );
}

async function insertOwnerInvitation(
  tx: Executor,
  input: { agencyId: string; email: string; actor: BackofficeActor; now: Date },
) {
  await lockAgency(tx, input.agencyId);
  await tx
    .update(agencyInvitation)
    .set({ revokedAt: input.now })
    .where(
      and(
        eq(agencyInvitation.agencyId, input.agencyId),
        eq(agencyInvitation.email, input.email),
        isNull(agencyInvitation.acceptedAt),
        isNull(agencyInvitation.revokedAt),
      ),
    );
  const { token, tokenHash } = createInvitationToken();
  const expiresAt = invitationExpiresAt(input.now);
  await tx.insert(agencyInvitation).values({
    agencyId: input.agencyId,
    email: input.email,
    role: "owner",
    tokenHash,
    invitedByBackofficeUserId: inviterId(input.actor),
    expiresAt,
    createdAt: input.now,
  });
  return { token, expiresAt };
}

/** Cria a Agência e o convite do Dono. O token só sai nesta resposta. */
export async function createAgencyWithOwnerInvitation(input: {
  name: string;
  ownerEmail: string;
  actor: BackofficeActor;
  now?: Date;
}): Promise<InviteResult> {
  const name = input.name.trim();
  if (!name || name.length > 255) return { ok: false, error: "invalid_name" };
  const email = normalizeInvitationEmail(input.ownerEmail);
  if (!email) return { ok: false, error: "invalid_email" };
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [created] = await tx.insert(agency).values({ name }).returning({ id: agency.id });
    const { token, expiresAt } = await insertOwnerInvitation(tx, {
      agencyId: created.id,
      email,
      actor: input.actor,
      now,
    });
    return { ok: true, agencyId: created.id, token, email, expiresAt };
  });
}

/** Novo link de Dono (o anterior para o mesmo e-mail é cancelado). */
export async function createOwnerInvitation(input: {
  agencyId: string;
  ownerEmail: string;
  actor: BackofficeActor;
  now?: Date;
}): Promise<InviteResult> {
  const email = normalizeInvitationEmail(input.ownerEmail);
  if (!email) return { ok: false, error: "invalid_email" };
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: agency.id })
      .from(agency)
      .where(and(eq(agency.id, input.agencyId), isNull(agency.archivedAt)))
      .limit(1)
      .for("update");
    if (!existing) return { ok: false, error: "agency_not_found" };
    const { token, expiresAt } = await insertOwnerInvitation(tx, {
      agencyId: input.agencyId,
      email,
      actor: input.actor,
      now,
    });
    return { ok: true, agencyId: input.agencyId, token, email, expiresAt };
  });
}
