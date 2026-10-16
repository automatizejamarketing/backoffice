// Vínculo manual de Indicado — as regras, sem banco.
//
// Um administrador liga uma conta que já existe a um afiliado aprovado. Tudo o
// que decide se o vínculo pode acontecer mora aqui, com teste; a rota e a
// transação (`manual-link-queries.ts`) só buscam o estado e aplicam a decisão.
//
// O motor de comissão do frontend não muda (spec 2026-10-11, D2): ele passa a
// enxergar o Indicado novo e comissiona as cobranças pagas dele — inclusive as
// passadas — pela regra de sempre. Por isso a prévia mostra a BASE (cobranças e
// líquido) e nunca uma estimativa: estimar seria uma segunda cópia da regra de
// dinheiro (D7).

import type { BackofficeActor } from "@/lib/auth/rbac-core";
import { formatNumericDateInSaoPaulo } from "@/lib/backoffice/datetime-format";
import type { ReferralAffiliateStatus } from "@/lib/db/schema";
import type { ReferralAgreementTerms } from "./agreement";
import { formatCentavos } from "./write-off";

export const MANUAL_LINK_REASON_MAX_LENGTH = 500;
export const MANUAL_LINK_REASON_MESSAGE =
  "Informe o motivo do vínculo (até 500 caracteres)";
export const MANUAL_LINK_ADMIN_ONLY_MESSAGE =
  "Apenas administradores podem vincular indicados";
export const MANUAL_LINK_INVALID_USER_MESSAGE = "Usuário inválido";
export const MANUAL_LINK_AFFILIATE_NOT_FOUND_MESSAGE = "Afiliado não encontrado";
export const MANUAL_LINK_USER_NOT_FOUND_MESSAGE = "Usuário não encontrado";
/** A trava única de `referral_customers.user_id` (migration 0041). */
export const REFERRAL_CUSTOMER_USER_UNIQUE_CONSTRAINT =
  "referral_customers_user_id_unique";

/**
 * Só o cargo `admin`. Hoje `affiliates:manage` já é exclusivo dele, mas o
 * pedido é explícito sobre o CARGO: se a permissão um dia for concedida a
 * outro papel, vincular continua sendo de administrador.
 */
export function manualLinkActorAllowed(
  actor: Pick<BackofficeActor, "role">,
): boolean {
  return actor.role === "admin";
}

export type ManualLinkReasonResult =
  | { ok: true; reason: string }
  | { ok: false; message: string };

export function parseManualLinkReason(raw: unknown): ManualLinkReasonResult {
  if (typeof raw !== "string") {
    return { ok: false, message: MANUAL_LINK_REASON_MESSAGE };
  }
  const reason = raw.trim();
  if (reason.length === 0 || reason.length > MANUAL_LINK_REASON_MAX_LENGTH) {
    return { ok: false, message: MANUAL_LINK_REASON_MESSAGE };
  }
  return { ok: true, reason };
}

export type ManualLinkState = {
  affiliate: { id: string; status: ReferralAffiliateStatus; userId: string };
  agreement: { id: string } | null;
  user: { id: string; createdAt: Date | null } | null;
  /** O Indicado que este usuário já é, de qualquer afiliado. */
  existingCustomer: {
    affiliateId: string;
    /** Nome do afiliado dono, ou o e-mail quando não há nome. */
    affiliateLabel: string;
    signedUpAt: Date;
  } | null;
};

export type ManualLinkDecision =
  | { ok: true; agreementId: string; signedUpAt: Date }
  | { ok: false; status: 404 | 409; message: string };

function refuse(status: 404 | 409, message: string): ManualLinkDecision {
  return { ok: false, status, message };
}

export function describeExistingCustomer(
  existing: NonNullable<ManualLinkState["existingCustomer"]>,
  affiliateId: string,
): string {
  const since = formatNumericDateInSaoPaulo(existing.signedUpAt);
  return existing.affiliateId === affiliateId
    ? `Já é indicado deste afiliado desde ${since}`
    : `Já é indicado de ${existing.affiliateLabel} desde ${since}`;
}

/**
 * A decisão, na ordem da tabela R7 da spec. O Indicado nasce no acordo
 * VIGENTE do afiliado e datado pelo cadastro da conta — como na atribuição
 * por clique (`attribution-service.ts`: `accountCreatedAt ?? new Date()`).
 */
export function planManualReferralLink(
  state: ManualLinkState,
  now: Date,
): ManualLinkDecision {
  const { affiliate, agreement, user, existingCustomer } = state;
  if (!user) return refuse(404, MANUAL_LINK_USER_NOT_FOUND_MESSAGE);
  if (affiliate.status !== "approved") {
    return refuse(409, "Só afiliado aprovado pode receber indicado");
  }
  if (!agreement) return refuse(409, "Afiliado sem acordo vigente");
  // A mesma regra da atribuição: indicar a si mesmo não gera comissão (ADR 0024).
  if (user.id === affiliate.userId) {
    return refuse(409, "Esta é a conta do próprio afiliado");
  }
  // O primeiro afiliado é dono para sempre (D3): nunca transferir.
  if (existingCustomer) {
    return refuse(409, describeExistingCustomer(existingCustomer, affiliate.id));
  }
  return {
    ok: true,
    agreementId: agreement.id,
    signedUpAt: user.createdAt ?? now,
  };
}

export type ManualLinkCharges = {
  /** Cobranças que a varredura do motor vai processar (cortes de R9). */
  eligibleCount: number;
  /** Soma do líquido das elegíveis que já o têm. */
  netCentavos: number;
  /** Elegíveis ainda sem líquido — esperam o reconciliador. */
  awaitingSettlementCount: number;
};

export function describeManualLinkCharges(charges: ManualLinkCharges): string {
  if (charges.eligibleCount === 0) {
    return "Nenhuma cobrança paga até agora — só as próximas vão comissionar";
  }
  const count =
    charges.eligibleCount === 1
      ? "1 cobrança de assinatura paga"
      : `${charges.eligibleCount} cobranças de assinatura pagas`;
  const parts = [count, `${formatCentavos(charges.netCentavos)} de líquido`];
  if (charges.awaitingSettlementCount > 0) {
    parts.push(`${charges.awaitingSettlementCount} aguardando liquidação`);
  }
  return parts.join(" · ");
}

/**
 * Quantas comissões o acordo concede a um Indicado. Espelha
 * `agreementCommissionQuota` do motor (automatize-frontend
 * `lib/referral/commission.ts`): só informa a prévia, nunca decide dinheiro.
 */
export function manualLinkCommissionQuota(
  agreement: Pick<ReferralAgreementTerms, "duration" | "durationCycles">,
): number | null {
  switch (agreement.duration) {
    case "first_sale":
      return 1;
    case "n_cycles":
      return agreement.durationCycles ?? 0;
    default:
      return null;
  }
}

/**
 * O aviso de cota: a varredura do motor processa da cobrança mais antiga para
 * a mais nova, então o histórico consome a cota antes das cobranças futuras.
 */
export function describeManualLinkQuota(
  agreement: Pick<ReferralAgreementTerms, "duration" | "durationCycles">,
  eligibleCount: number,
): string | null {
  const quota = manualLinkCommissionQuota(agreement);
  if (quota === null) return null;
  const consumed = Math.min(eligibleCount, quota);
  if (consumed < 1) return null;
  const unit = quota === 1 ? "comissão" : "comissões";
  const head =
    consumed === 1
      ? `A cobrança mais antiga consome 1 de ${quota} ${unit} do acordo.`
      : `As ${consumed} cobranças mais antigas consomem ${consumed} de ${quota} ${unit} do acordo.`;
  return consumed === quota
    ? `${head} As próximas cobranças não vão comissionar.`
    : head;
}

/**
 * A corrida perdida para a trava única de `referral_customers.user_id`. O
 * Drizzle embrulha o erro do postgres-js em `cause`, então a busca desce pela
 * cadeia (com teto e sem seguir ciclo).
 */
export function isReferralCustomerUserUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || typeof current !== "object" || seen.has(current)) return false;
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (
      candidate.code === "23505" &&
      candidate.constraint_name === REFERRAL_CUSTOMER_USER_UNIQUE_CONSTRAINT
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export type ReferralCustomerManualLink = { linkedAt: string; adminEmail: string };

/** As linhas `customer_linked` da auditoria, indexadas pelo Indicado. */
export function indexManualLinks(
  actions: readonly { details: unknown; adminEmail: string; createdAt: Date }[],
): Map<string, ReferralCustomerManualLink> {
  const ordered = [...actions].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
  const links = new Map<string, ReferralCustomerManualLink>();
  for (const action of ordered) {
    const customerId =
      action.details && typeof action.details === "object"
        ? (action.details as { customerId?: unknown }).customerId
        : undefined;
    if (typeof customerId !== "string" || links.has(customerId)) continue;
    links.set(customerId, {
      linkedAt: action.createdAt.toISOString(),
      adminEmail: action.adminEmail,
    });
  }
  return links;
}
