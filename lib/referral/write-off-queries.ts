// A baixa de saldo negativo ligada ao banco (ticket 12).
//
// Três decisões deste arquivo carregam dinheiro:
//
//   1. **A baixa é um LANÇAMENTO, nunca um `UPDATE`.** Nenhuma linha anterior
//      do ledger é tocada: a compensação entra como uma linha nova, positiva,
//      do tipo `write_off`, com autor e motivo. É por isso que o extrato do
//      afiliado continua explicando de onde veio cada centavo mesmo depois de
//      uma correção (ADR 0026).
//   2. **O saldo é lido dentro da transação, com a linha do afiliado
//      travada.** Duas baixas simultâneas veriam a mesma dívida e a pagariam
//      duas vezes; o `SELECT ... FOR UPDATE` é o que serializa as duas.
//   3. **O saldo é agregado no Postgres, e não somado em memória.** É a
//      diferença deste lado: o painel do afiliado soma UM afiliado e usa a
//      mesma função do extrato (`automatize-frontend/lib/referral/balance.ts`),
//      enquanto o operador precisa varrer TODOS para saber quem está negativo.
//      A regra somada é literalmente a mesma — liberado (`available_at` nulo ou
//      vencido) menos os saques em aberto — e está escrita uma vez só, na
//      constante `releasedSum` abaixo.

import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  referralAdminAction,
  referralAffiliate,
  referralLedgerEntry,
  referralPayoutRequest,
  user,
  type ReferralLedgerEntry,
} from "@/lib/db/schema";
import { OPEN_REFERRAL_PAYOUT_STATUSES } from "./payout";
import { ReferralOperationError } from "./queries";
import {
  evaluateReferralWriteOff,
  formatCentavos,
  referralDebtCentavos,
} from "./write-off";

type Executor =
  | typeof db
  | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

/**
 * Liberado: o lançamento sem carência (`available_at` nulo — saque pago, baixa)
 * ou com a carência já vencida. `<=` porque a carência termina NO instante
 * marcado, não um tique depois — a mesma comparação de `isLedgerEntryReleased`
 * no frontend.
 *
 * A condição é montada com `isNull`/`lte` em vez de interpolada no template:
 * um `Date` posto direto num `sql` cru chega ao driver sem o tipo da coluna e
 * estoura na serialização. Com os operadores do drizzle, o parâmetro sai
 * codificado como o `timestamp` que a coluna é.
 */
function releasedSum(now: Date) {
  const released = or(
    isNull(referralLedgerEntry.availableAt),
    lte(referralLedgerEntry.availableAt, now),
  );
  return sql<number>`COALESCE(SUM(CASE WHEN ${released} THEN ${referralLedgerEntry.amountCentavos} ELSE 0 END), 0)::int`;
}

export type ReferralAffiliateBalance = {
  /** Soma dos lançamentos já liberados. Pode ser negativa. */
  releasedCentavos: number;
  /** Soma dos saques em aberto — eles não escrevem no ledger enquanto abertos. */
  blockedCentavos: number;
  /** Liberado menos bloqueado: o número que libera ou trava o saque. */
  availableCentavos: number;
};

/** O saldo de UM afiliado, agregado no banco. Aceita transação. */
export async function getReferralAffiliateBalance(
  affiliateId: string,
  now: Date = new Date(),
  executor: Executor = db,
): Promise<ReferralAffiliateBalance> {
  const [ledger] = await executor
    .select({ released: releasedSum(now) })
    .from(referralLedgerEntry)
    .where(eq(referralLedgerEntry.affiliateId, affiliateId));

  const [open] = await executor
    .select({
      blocked: sql<number>`COALESCE(SUM(${referralPayoutRequest.amountCentavos}), 0)::int`,
    })
    .from(referralPayoutRequest)
    .where(
      and(
        eq(referralPayoutRequest.affiliateId, affiliateId),
        inArray(referralPayoutRequest.status, [
          ...OPEN_REFERRAL_PAYOUT_STATUSES,
        ]),
      ),
    );

  const releasedCentavos = Number(ledger?.released ?? 0);
  const blockedCentavos = Number(open?.blocked ?? 0);

  return {
    releasedCentavos,
    blockedCentavos,
    availableCentavos: releasedCentavos - blockedCentavos,
  };
}

export type NegativeReferralBalance = ReferralAffiliateBalance & {
  affiliateId: string;
  affiliateCode: string;
  affiliateStatus: string;
  /** O negativo em módulo — o quanto a baixa teria de cobrir para zerar. */
  debtCentavos: number;
  user: { id: string; email: string; name: string | null };
};

/**
 * Quem está negativo, e quanto deve. É a fila da baixa: sem esta lista o
 * operador teria de adivinhar em quem olhar, e um afiliado negativo ficaria
 * travado até reclamar.
 */
export async function listNegativeReferralBalances(
  now: Date = new Date(),
): Promise<NegativeReferralBalance[]> {
  const ledgerTotals = await db
    .select({
      affiliateId: referralLedgerEntry.affiliateId,
      released: releasedSum(now),
    })
    .from(referralLedgerEntry)
    .groupBy(referralLedgerEntry.affiliateId);

  const openTotals = await db
    .select({
      affiliateId: referralPayoutRequest.affiliateId,
      blocked: sql<number>`COALESCE(SUM(${referralPayoutRequest.amountCentavos}), 0)::int`,
    })
    .from(referralPayoutRequest)
    .where(
      inArray(referralPayoutRequest.status, [...OPEN_REFERRAL_PAYOUT_STATUSES]),
    )
    .groupBy(referralPayoutRequest.affiliateId);

  const blockedByAffiliate = new Map(
    openTotals.map((row) => [row.affiliateId, Number(row.blocked)]),
  );

  const negatives = ledgerTotals
    .map((row) => {
      const releasedCentavos = Number(row.released);
      const blockedCentavos = blockedByAffiliate.get(row.affiliateId) ?? 0;
      return {
        affiliateId: row.affiliateId,
        releasedCentavos,
        blockedCentavos,
        availableCentavos: releasedCentavos - blockedCentavos,
      };
    })
    .filter((row) => row.availableCentavos < 0);

  if (negatives.length === 0) return [];

  const identities = await db
    .select({
      id: referralAffiliate.id,
      code: referralAffiliate.code,
      status: referralAffiliate.status,
      user: { id: user.id, email: user.email, name: user.name },
    })
    .from(referralAffiliate)
    .innerJoin(user, eq(user.id, referralAffiliate.userId))
    .where(
      inArray(
        referralAffiliate.id,
        negatives.map((row) => row.affiliateId),
      ),
    );

  const identityById = new Map(identities.map((row) => [row.id, row]));

  return (
    negatives
      .flatMap((row) => {
        const identity = identityById.get(row.affiliateId);
        if (!identity) return [];
        return [
          {
            ...row,
            affiliateCode: identity.code,
            affiliateStatus: identity.status,
            debtCentavos: referralDebtCentavos(row.availableCentavos),
            user: identity.user,
          },
        ];
      })
      // A maior dívida primeiro: é a que trava mais dinheiro do afiliado.
      .sort((a, b) => b.debtCentavos - a.debtCentavos)
  );
}

export type WriteOffReferralBalanceResult = {
  entry: ReferralLedgerEntry;
  balanceBefore: ReferralAffiliateBalance;
  availableAfterCentavos: number;
  clearsBalance: boolean;
};

/**
 * Lança a baixa. Autor e motivo são obrigatórios e ficam gravados em dois
 * lugares de propósito: no lançamento (`created_by`, `description`), que é o
 * que o afiliado vê, e em `referral_admin_actions`, que é o histórico da
 * operação.
 *
 * `available_at` nulo: uma baixa não cumpre carência nenhuma — ela existe para
 * destravar o saque agora.
 */
export async function writeOffReferralNegativeBalance({
  affiliateId,
  amountCentavos,
  reason,
  adminEmail,
  now = new Date(),
}: {
  affiliateId: string;
  /** `null` dá baixa na dívida inteira. */
  amountCentavos: number | null;
  reason: string;
  adminEmail: string;
  now?: Date;
}): Promise<WriteOffReferralBalanceResult> {
  return db.transaction(async (tx) => {
    // Trava a linha do afiliado, não o ledger: é ela que serializa duas baixas
    // simultâneas sobre a mesma dívida.
    const [affiliate] = await tx
      .select()
      .from(referralAffiliate)
      .where(eq(referralAffiliate.id, affiliateId))
      .limit(1)
      .for("update");
    if (!affiliate) {
      throw new ReferralOperationError(404, "Afiliado não encontrado");
    }

    const balanceBefore = await getReferralAffiliateBalance(
      affiliateId,
      now,
      tx,
    );

    const evaluation = evaluateReferralWriteOff({
      availableCentavos: balanceBefore.availableCentavos,
      requestedCentavos: amountCentavos,
      reason,
    });
    if (!evaluation.ok) {
      throw new ReferralOperationError(
        evaluation.refusal === "balance_not_negative" ? 409 : 400,
        evaluation.message,
      );
    }

    // O id é gerado aqui para servir de chave do evento: a baixa não deriva de
    // um pagamento nem de um pedido, então não existe identidade externa da
    // qual derivar idempotência. Um retry da MESMA baixa é um lançamento novo
    // por definição — é o operador que decide dar baixa duas vezes, e a
    // segunda seria recusada pelo saldo já zerado.
    const entryId = crypto.randomUUID();

    const [entry] = await tx
      .insert(referralLedgerEntry)
      .values({
        id: entryId,
        affiliateId,
        type: "write_off",
        amountCentavos: evaluation.amountCentavos,
        eventKey: `referral-write-off:${entryId}`,
        availableAt: null,
        description: `Baixa de saldo negativo: ${evaluation.reason}`,
        createdBy: adminEmail,
        createdAt: now,
      })
      .returning();

    await tx.insert(referralAdminAction).values({
      affiliateId,
      adminEmail,
      action: "balance_written_off",
      reason: evaluation.reason,
      details: {
        ledgerEntryId: entry.id,
        amountCentavos: evaluation.amountCentavos,
        availableBeforeCentavos: balanceBefore.availableCentavos,
        availableAfterCentavos:
          balanceBefore.availableCentavos + evaluation.amountCentavos,
        clearsBalance: evaluation.clearsBalance,
      },
      createdAt: now,
    });

    return {
      entry,
      balanceBefore,
      availableAfterCentavos:
        balanceBefore.availableCentavos + evaluation.amountCentavos,
      clearsBalance: evaluation.clearsBalance,
    };
  });
}

/** Uma linha de resumo para o log da operação e para o script de verificação. */
export function describeWriteOff(result: WriteOffReferralBalanceResult): string {
  return [
    `baixa de ${formatCentavos(result.entry.amountCentavos)}`,
    `saldo ${formatCentavos(result.balanceBefore.availableCentavos)}`,
    `→ ${formatCentavos(result.availableAfterCentavos)}`,
    result.clearsBalance ? "(zerado)" : "(ainda negativo)",
  ].join(" ");
}
