// Operação do programa de afiliados v2 no backoffice.
//
// A regra que este arquivo existe para garantir: **aprovar é criar o acordo, na
// mesma transação**. Não pode existir afiliado aprovado sem acordo vigente —
// é o invariante que impede uma comissão de nascer sem uma regra que a
// explique. Por isso toda aprovação é um `db.transaction`, e uma falha ao
// inserir o acordo desfaz a aprovação junto.
//
// O mesmo caminho aprova um pedido e cria uma afiliação para quem não pediu:
// recrutar ativamente não merece um segundo formulário nem um segundo conjunto
// de regras.

import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  affiliate as legacyAffiliate,
  referralAdminAction,
  referralAffiliate,
  referralAffiliateBlock,
  referralAgreement,
  referralCustomer,
  user,
  type ReferralAffiliate,
  type ReferralAffiliateStatus,
  type ReferralAgreement,
} from "@/lib/db/schema";
import { generateReferralCode } from "./code";
import type { ReferralAgreementTerms } from "./agreement";
import {
  migratesExistingCustomers,
  type ReferralMigrationChoice,
} from "./renegotiation";

type Executor =
  | typeof db
  | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

/** Erro de operação com o status HTTP que a rota deve devolver. */
export class ReferralOperationError extends Error {
  status: 400 | 404 | 409;

  constructor(status: 400 | 404 | 409, message: string) {
    super(message);
    this.name = "ReferralOperationError";
    this.status = status;
  }
}

export type ReferralAffiliateListItem = {
  id: string;
  code: string;
  status: ReferralAffiliateStatus;
  requestedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  blockedBy: string | null;
  blockedAt: string | null;
  blockReason: string | null;
  user: { id: string; email: string; name: string | null };
  agreement: {
    id: string;
    format: ReferralAgreement["format"];
    percentageBps: number | null;
    fixedAmountCentavos: number | null;
    duration: ReferralAgreement["duration"];
    durationCycles: number | null;
    effectiveFrom: string;
  } | null;
  /**
   * Quantos indicados o afiliado já tem — TODOS eles, inclusive os que uma
   * renegociação anterior deixou num acordo superado. É o número que a
   * renegociação alcança quando o operador escolhe migrar, e sem ele a escolha
   * do ticket 13 seria tomada no escuro.
   */
  customerCount: number;
};

export async function listReferralAffiliates(
  filters: { status?: ReferralAffiliateStatus },
  limit = 50,
  offset = 0,
): Promise<ReferralAffiliateListItem[]> {
  const rows = await db
    .select({
      affiliate: referralAffiliate,
      user: { id: user.id, email: user.email, name: user.name },
      agreement: referralAgreement,
    })
    .from(referralAffiliate)
    .innerJoin(user, eq(user.id, referralAffiliate.userId))
    // O acordo vigente, quando existe. Acordos superados nunca são apagados,
    // então o filtro por `superseded_at IS NULL` é o que separa "a regra de
    // agora" do histórico.
    .leftJoin(
      referralAgreement,
      and(
        eq(referralAgreement.affiliateId, referralAffiliate.id),
        isNull(referralAgreement.supersededAt),
      ),
    )
    .where(
      filters.status ? eq(referralAffiliate.status, filters.status) : undefined,
    )
    .orderBy(desc(referralAffiliate.requestedAt))
    .limit(limit)
    .offset(offset);

  const customerCounts = await countCustomersByAffiliate(
    rows.map((row) => row.affiliate.id),
  );

  return rows.map(({ affiliate, user: affiliateUser, agreement }) => ({
    id: affiliate.id,
    code: affiliate.code,
    status: affiliate.status,
    requestedAt: affiliate.requestedAt.toISOString(),
    approvedBy: affiliate.approvedBy,
    approvedAt: affiliate.approvedAt?.toISOString() ?? null,
    rejectedBy: affiliate.rejectedBy,
    rejectedAt: affiliate.rejectedAt?.toISOString() ?? null,
    rejectionReason: affiliate.rejectionReason,
    blockedBy: affiliate.blockedBy,
    blockedAt: affiliate.blockedAt?.toISOString() ?? null,
    blockReason: affiliate.blockReason,
    user: affiliateUser,
    agreement: agreement
      ? {
          id: agreement.id,
          format: agreement.format,
          percentageBps: agreement.percentageBps,
          fixedAmountCentavos: agreement.fixedAmountCentavos,
          duration: agreement.duration,
          durationCycles: agreement.durationCycles,
          effectiveFrom: agreement.effectiveFrom.toISOString(),
        }
      : null,
    customerCount: customerCounts.get(affiliate.id) ?? 0,
  }));
}

/**
 * Quantos indicados cada afiliado tem. Uma consulta agregada só para as linhas
 * da página — contar em memória exigiria trazer todos os indicados de todos os
 * afiliados para descartar 99% deles.
 */
async function countCustomersByAffiliate(
  affiliateIds: string[],
  executor: Executor = db,
): Promise<Map<string, number>> {
  if (affiliateIds.length === 0) return new Map();

  const rows = await executor
    .select({
      affiliateId: referralCustomer.affiliateId,
      total: sql<number>`COUNT(*)::int`,
    })
    .from(referralCustomer)
    .where(inArray(referralCustomer.affiliateId, affiliateIds))
    .groupBy(referralCustomer.affiliateId);

  return new Map(rows.map((row) => [row.affiliateId, Number(row.total)]));
}

const CODE_ALLOCATION_ATTEMPTS = 5;

/**
 * Sorteia um código ainda não usado. Além do namespace do v2, o candidato é
 * conferido contra os códigos do v1: eles não são portados (ADR 0024), e um
 * código novo que por acaso repetisse uma string antiga tornaria impossível
 * dizer, lendo um link, de qual programa ele fala.
 */
async function allocateReferralCode(executor: Executor): Promise<string> {
  for (let attempt = 0; attempt < CODE_ALLOCATION_ATTEMPTS; attempt += 1) {
    const candidate = generateReferralCode();

    const [taken] = await executor
      .select({ code: referralAffiliate.code })
      .from(referralAffiliate)
      .where(eq(referralAffiliate.code, candidate))
      .limit(1);
    if (taken) continue;

    const [legacyTaken] = await executor
      .select({ code: legacyAffiliate.code })
      .from(legacyAffiliate)
      .where(
        or(
          eq(legacyAffiliate.code, candidate),
          eq(legacyAffiliate.code, candidate.toLowerCase()),
        ),
      )
      .limit(1);
    if (legacyTaken) continue;

    return candidate;
  }

  throw new ReferralOperationError(
    409,
    "Não foi possível gerar um código único para o afiliado",
  );
}

export type ApproveReferralAffiliateResult = {
  affiliate: ReferralAffiliate;
  agreement: ReferralAgreement;
  /** `true` quando a afiliação foi criada por recrutamento, sem pedido. */
  recruited: boolean;
};

/**
 * Aprova um pedido — ou cria a afiliação de quem nunca pediu — definindo o
 * Acordo de Comissão na MESMA transação. Passe `affiliateId` para decidir sobre
 * um pedido da fila, ou `userId` para recrutar.
 */
export async function approveReferralAffiliate({
  affiliateId,
  userId,
  terms,
  adminEmail,
}: {
  affiliateId?: string | null;
  userId?: string | null;
  terms: ReferralAgreementTerms;
  adminEmail: string;
}): Promise<ApproveReferralAffiliateResult> {
  if (!affiliateId && !userId) {
    throw new ReferralOperationError(
      400,
      "Informe o afiliado ou o usuário a ser aprovado",
    );
  }

  return db.transaction(async (tx) => {
    let existing: ReferralAffiliate | undefined;

    if (affiliateId) {
      [existing] = await tx
        .select()
        .from(referralAffiliate)
        .where(eq(referralAffiliate.id, affiliateId))
        .limit(1)
        .for("update");
      if (!existing) {
        throw new ReferralOperationError(404, "Afiliado não encontrado");
      }
    } else if (userId) {
      const [target] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      if (!target) {
        throw new ReferralOperationError(404, "Usuário não encontrado");
      }
      // Recrutar alguém que, sem o operador saber, já tinha pedido não é um
      // erro: é o mesmo caminho decidindo sobre o pedido que já existe.
      [existing] = await tx
        .select()
        .from(referralAffiliate)
        .where(eq(referralAffiliate.userId, userId))
        .limit(1)
        .for("update");
    } else {
      throw new ReferralOperationError(
        400,
        "Informe o afiliado ou o usuário a ser aprovado",
      );
    }

    if (existing?.status === "approved") {
      throw new ReferralOperationError(409, "Este afiliado já está aprovado");
    }
    if (existing?.status === "blocked") {
      throw new ReferralOperationError(
        409,
        "Este afiliado está bloqueado — reative antes de definir um acordo novo",
      );
    }

    const now = new Date();
    const recruited = !existing;

    let affiliate: ReferralAffiliate;
    if (existing) {
      // Aprovar limpa a recusa anterior: o histórico da decisão fica em
      // `referral_admin_actions`, e deixar o motivo antigo na linha faria o
      // afiliado ver "recusado" na tela depois de ter sido aprovado.
      [affiliate] = await tx
        .update(referralAffiliate)
        .set({
          status: "approved",
          approvedBy: adminEmail,
          approvedAt: now,
          rejectedBy: null,
          rejectedAt: null,
          rejectionReason: null,
          updatedAt: now,
        })
        .where(eq(referralAffiliate.id, existing.id))
        .returning();
    } else if (userId) {
      const code = await allocateReferralCode(tx);
      [affiliate] = await tx
        .insert(referralAffiliate)
        .values({
          userId,
          code,
          status: "approved",
          requestedAt: now,
          approvedBy: adminEmail,
          approvedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
    } else {
      throw new ReferralOperationError(
        400,
        "Informe o afiliado ou o usuário a ser aprovado",
      );
    }

    // O índice único parcial `referral_agreements_one_current` é o dono desta
    // regra: se por qualquer motivo já houvesse um acordo vigente, o insert
    // falha e a aprovação inteira é desfeita.
    const [agreement] = await tx
      .insert(referralAgreement)
      .values({
        affiliateId: affiliate.id,
        format: terms.format,
        percentageBps: terms.percentageBps,
        fixedAmountCentavos: terms.fixedAmountCentavos,
        calculationBase: "net",
        duration: terms.duration,
        durationCycles: terms.durationCycles,
        effectiveFrom: now,
        createdBy: adminEmail,
        createdAt: now,
      })
      .returning();

    await tx.insert(referralAdminAction).values([
      {
        affiliateId: affiliate.id,
        adminEmail,
        action: "affiliate_approved",
        details: { recruited, agreementId: agreement.id },
        createdAt: now,
      },
      {
        affiliateId: affiliate.id,
        adminEmail,
        action: "agreement_created",
        details: {
          agreementId: agreement.id,
          format: terms.format,
          percentageBps: terms.percentageBps,
          fixedAmountCentavos: terms.fixedAmountCentavos,
          duration: terms.duration,
          durationCycles: terms.durationCycles,
          calculationBase: "net",
        },
        createdAt: now,
      },
    ]);

    return { affiliate, agreement, recruited };
  });
}

export type RenegotiateReferralAgreementResult = {
  /** O acordo que acabou de ser marcado como superado. Continua no banco. */
  previousAgreement: ReferralAgreement;
  /** O acordo novo — o único vigente do afiliado a partir de agora. */
  agreement: ReferralAgreement;
  choice: ReferralMigrationChoice;
  /** Quantos indicados passaram a apontar para o acordo novo. */
  migratedCustomerCount: number;
  /** Quantos indicados o afiliado tem no total, migrados ou não. */
  totalCustomerCount: number;
};

/**
 * Renegocia o acordo de um afiliado (ticket 13).
 *
 * Uma transação, quatro escritas, e nenhuma delas destrutiva:
 *
 *   1. o acordo vigente ganha `superseded_at` — marcado como superado, nunca
 *      apagado, porque é ele que explica as comissões que já produziu;
 *   2. o acordo novo é inserido; o índice único parcial
 *      `referral_agreements_one_current` é quem garante que continue havendo
 *      exatamente UM vigente por afiliado;
 *   3. os indicados existentes passam a apontar para o acordo novo — ou não,
 *      conforme a `choice`, que chega já validada e nunca por default;
 *   4. a renegociação é registrada com autor, data e a escolha tomada.
 *
 * Nenhuma comissão é tocada: ela carrega o snapshot da regra que a produziu, e
 * a escolha vale da próxima fatura em diante, porque o motor lê o acordo
 * APONTADO pelo Indicado (`commission-service.ts`).
 */
export async function renegotiateReferralAgreement({
  affiliateId,
  terms,
  choice,
  adminEmail,
}: {
  affiliateId: string;
  terms: ReferralAgreementTerms;
  choice: ReferralMigrationChoice;
  adminEmail: string;
}): Promise<RenegotiateReferralAgreementResult> {
  return db.transaction(async (tx) => {
    const [affiliate] = await tx
      .select()
      .from(referralAffiliate)
      .where(eq(referralAffiliate.id, affiliateId))
      .limit(1)
      .for("update");
    if (!affiliate) {
      throw new ReferralOperationError(404, "Afiliado não encontrado");
    }
    // Um afiliado BLOQUEADO pode ser renegociado. O acordo novo é gravado e
    // fica sem efeito enquanto o bloqueio durar — bloqueado não gera comissão
    // de qualquer forma — e passa a reger as faturas seguintes se ele for
    // reativado.
    //
    // A regra anterior recusava, e ao recusar empurrava o operador para a
    // sequência reativar → renegociar → bloquear de novo. Essa janela não é
    // inócua: `affiliateEarnsAt` olha o status ATUAL, então enquanto ela está
    // aberta toda fatura ainda não processada comissiona — inclusive as que
    // foram pagas durante o bloqueio. A recusa, feita para ser conservadora,
    // era o caminho mais curto para pagar comissão que não deveria existir.
    if (affiliate.status !== "approved" && affiliate.status !== "blocked") {
      throw new ReferralOperationError(
        409,
        "Só um afiliado aprovado tem acordo a renegociar",
      );
    }

    // O acordo vigente é travado junto: sem isso duas renegociações simultâneas
    // superariam o mesmo acordo e uma das duas escolhas de migração se perderia
    // sem deixar rastro.
    const [current] = await tx
      .select()
      .from(referralAgreement)
      .where(
        and(
          eq(referralAgreement.affiliateId, affiliateId),
          isNull(referralAgreement.supersededAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) {
      throw new ReferralOperationError(
        409,
        "Este afiliado não tem acordo vigente — aprove-o novamente definindo o acordo",
      );
    }

    const now = new Date();

    const [previousAgreement] = await tx
      .update(referralAgreement)
      .set({ supersededAt: now })
      .where(eq(referralAgreement.id, current.id))
      .returning();

    const [agreement] = await tx
      .insert(referralAgreement)
      .values({
        affiliateId,
        format: terms.format,
        percentageBps: terms.percentageBps,
        fixedAmountCentavos: terms.fixedAmountCentavos,
        calculationBase: "net",
        duration: terms.duration,
        durationCycles: terms.durationCycles,
        effectiveFrom: now,
        createdBy: adminEmail,
        createdAt: now,
      })
      .returning();

    const [{ total: totalCustomerCount }] = await tx
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(referralCustomer)
      .where(eq(referralCustomer.affiliateId, affiliateId));

    // Migrar alcança TODOS os indicados do afiliado, e não só os que apontavam
    // para o acordo recém-superado: uma renegociação anterior pode ter deixado
    // parte deles num acordo ainda mais antigo, e "migrar os indicados
    // existentes" é o que o operador acabou de escolher para todos eles.
    let migratedCustomerCount = 0;
    if (migratesExistingCustomers(choice)) {
      const migrated = await tx
        .update(referralCustomer)
        .set({ agreementId: agreement.id })
        .where(
          and(
            eq(referralCustomer.affiliateId, affiliateId),
            ne(referralCustomer.agreementId, agreement.id),
          ),
        )
        .returning({ id: referralCustomer.id });
      migratedCustomerCount = migrated.length;
    }

    await tx.insert(referralAdminAction).values({
      affiliateId,
      adminEmail,
      action: "agreement_renegotiated",
      details: {
        previousAgreementId: previousAgreement.id,
        agreementId: agreement.id,
        migrateExistingCustomers: migratesExistingCustomers(choice),
        migratedCustomerCount,
        totalCustomerCount: Number(totalCustomerCount),
        format: terms.format,
        percentageBps: terms.percentageBps,
        fixedAmountCentavos: terms.fixedAmountCentavos,
        duration: terms.duration,
        durationCycles: terms.durationCycles,
        calculationBase: "net",
      },
      createdAt: now,
    });

    return {
      previousAgreement,
      agreement,
      choice,
      migratedCustomerCount,
      totalCustomerCount: Number(totalCustomerCount),
    };
  });
}

export async function rejectReferralAffiliate({
  affiliateId,
  reason,
  adminEmail,
}: {
  affiliateId: string;
  reason: string | null;
  adminEmail: string;
}): Promise<ReferralAffiliate> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(referralAffiliate)
      .where(eq(referralAffiliate.id, affiliateId))
      .limit(1)
      .for("update");
    if (!existing) {
      throw new ReferralOperationError(404, "Afiliado não encontrado");
    }
    if (existing.status !== "pending") {
      throw new ReferralOperationError(
        409,
        "Só um pedido pendente pode ser recusado",
      );
    }

    const now = new Date();
    const [updated] = await tx
      .update(referralAffiliate)
      .set({
        status: "rejected",
        rejectedBy: adminEmail,
        rejectedAt: now,
        rejectionReason: reason,
        updatedAt: now,
      })
      .where(eq(referralAffiliate.id, affiliateId))
      .returning();

    await tx.insert(referralAdminAction).values({
      affiliateId,
      adminEmail,
      action: "affiliate_rejected",
      reason,
      createdAt: now,
    });

    return updated;
  });
}

/**
 * Bloquear interrompe a geração de comissão nova. O acordo vigente NÃO é
 * superado: ele continua sendo a regra dos indicados que já existem, e o
 * afiliado continua vendo o que já é dele.
 */
export async function blockReferralAffiliate({
  affiliateId,
  reason,
  adminEmail,
}: {
  affiliateId: string;
  reason: string | null;
  adminEmail: string;
}): Promise<ReferralAffiliate> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(referralAffiliate)
      .where(eq(referralAffiliate.id, affiliateId))
      .limit(1)
      .for("update");
    if (!existing) {
      throw new ReferralOperationError(404, "Afiliado não encontrado");
    }
    if (existing.status !== "approved") {
      throw new ReferralOperationError(
        409,
        "Só um afiliado aprovado pode ser bloqueado",
      );
    }

    const now = new Date();
    const [updated] = await tx
      .update(referralAffiliate)
      .set({
        status: "blocked",
        blockedBy: adminEmail,
        blockedAt: now,
        blockReason: reason,
        updatedAt: now,
      })
      .where(eq(referralAffiliate.id, affiliateId))
      .returning();

    // Abre o período no histórico. `referral_affiliates.blocked_at` continua
    // sendo escrito para a pergunta "está bloqueado agora?", mas quem responde
    // "estava bloqueado NAQUELA data?" — a pergunta de que o dinheiro depende —
    // é esta linha, que a reativação encerra em vez de apagar.
    await tx.insert(referralAffiliateBlock).values({
      affiliateId,
      blockedAt: now,
      blockedBy: adminEmail,
      blockReason: reason,
    });

    await tx.insert(referralAdminAction).values({
      affiliateId,
      adminEmail,
      action: "affiliate_blocked",
      reason,
      createdAt: now,
    });

    return updated;
  });
}

export async function reactivateReferralAffiliate({
  affiliateId,
  adminEmail,
}: {
  affiliateId: string;
  adminEmail: string;
}): Promise<ReferralAffiliate> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(referralAffiliate)
      .where(eq(referralAffiliate.id, affiliateId))
      .limit(1)
      .for("update");
    if (!existing) {
      throw new ReferralOperationError(404, "Afiliado não encontrado");
    }
    if (existing.status !== "blocked") {
      throw new ReferralOperationError(
        409,
        "Só um afiliado bloqueado pode ser reativado",
      );
    }

    // Reativar sem acordo vigente devolveria à ativa um afiliado cujas
    // comissões novas não teriam regra. Nunca deveria acontecer — o bloqueio
    // não supera o acordo — mas o invariante vale mais que a suposição.
    const [current] = await tx
      .select({ id: referralAgreement.id })
      .from(referralAgreement)
      .where(
        and(
          eq(referralAgreement.affiliateId, affiliateId),
          isNull(referralAgreement.supersededAt),
        ),
      )
      .limit(1);
    if (!current) {
      throw new ReferralOperationError(
        409,
        "Este afiliado não tem acordo vigente — aprove-o novamente definindo o acordo",
      );
    }

    const now = new Date();
    const [updated] = await tx
      .update(referralAffiliate)
      .set({
        status: "approved",
        blockedBy: null,
        blockedAt: null,
        blockReason: null,
        updatedAt: now,
      })
      .where(eq(referralAffiliate.id, affiliateId))
      .returning();

    // Encerra o período aberto em vez de apagá-lo. É o que impede uma fatura
    // paga DURANTE o bloqueio, e ainda não processada, de passar a comissionar
    // no instante da reativação.
    await tx
      .update(referralAffiliateBlock)
      .set({ unblockedAt: now, unblockedBy: adminEmail })
      .where(
        and(
          eq(referralAffiliateBlock.affiliateId, affiliateId),
          isNull(referralAffiliateBlock.unblockedAt),
        ),
      );

    await tx.insert(referralAdminAction).values({
      affiliateId,
      adminEmail,
      action: "affiliate_reactivated",
      createdAt: now,
    });

    return updated;
  });
}
