import type { VindiAffiliateStatus } from "@/lib/db/schema";

export type ExpertProductSaleGateCode =
  | "affiliate_missing"
  | "affiliate_pending"
  | "affiliate_rejected";

export type ExpertAffiliateReadiness =
  | { ready: true }
  | {
      ready: false;
      code: ExpertProductSaleGateCode;
      message: string;
      missing: string;
    };

export type ExpertProductSaleGate =
  | { allowed: true }
  | {
      allowed: false;
      code: ExpertProductSaleGateCode;
      message: string;
      missing: string;
    };

export type ExpertProductSaleGateInput = {
  ownerType: "automatize" | "expert";
  affiliateStatus: VindiAffiliateStatus | null;
  vindiProductsEnabled: boolean;
  offeringForSale: boolean;
};

const ADMIN_SALE_GATE_COPY: Record<
  ExpertProductSaleGateCode,
  { message: string; missing: string }
> = {
  affiliate_missing: {
    message:
      "Este produto de expert não pode vender: o afiliado Vindi ainda não foi criado.",
    missing:
      "Crie o afiliado Vindi deste expert. A Vindi envia um e-mail de verificação em cerca de 5 minutos.",
  },
  affiliate_pending: {
    message:
      "Este produto de expert não pode vender: a conta Vindi ainda está em verificação.",
    missing:
      "Peça ao expert que conclua a verificação no e-mail da Vindi (cerca de 5 minutos) e atualize o status.",
  },
  affiliate_rejected: {
    message:
      "Este produto de expert não pode vender: a conta Vindi Pagamentos não foi verificada.",
    missing:
      "O expert precisa ter uma conta Vindi Pagamentos verificada com o mesmo e-mail/login. Depois, atualize o status.",
  },
};

const EXPERT_SALE_GATE_COPY: Record<
  ExpertProductSaleGateCode,
  { message: string; missing: string }
> = {
  affiliate_missing: {
    message:
      "Seu produto ainda não pode vender: o afiliado Vindi não foi criado.",
    missing:
      "Peça à equipe Automatize para criar o afiliado Vindi com o e-mail da sua conta. A Vindi envia um e-mail de verificação em cerca de 5 minutos.",
  },
  affiliate_pending: {
    message:
      "Seu produto ainda não pode vender: a conta Vindi está em verificação.",
    missing:
      "Conclua a verificação no e-mail da Vindi (cerca de 5 minutos). A equipe atualiza o status depois.",
  },
  affiliate_rejected: {
    message:
      "Seu produto ainda não pode vender: sua conta Vindi Pagamentos não foi verificada.",
    missing:
      "Crie ou verifique sua conta Vindi Pagamentos com o mesmo e-mail do Automatize. Depois peça à equipe para atualizar o status.",
  },
};

const VERIFIED_STATUSES = new Set(["active", "verified"]);
const PENDING_STATUSES = new Set(["pending_approval", "pending"]);
const REJECTED_STATUSES = new Set(["blocked", "rejected", "inactive"]);

export function mapVindiAffiliateStatus(
  status: unknown,
): VindiAffiliateStatus {
  if (typeof status !== "string") return "unverified";
  const normalized = status.trim().toLowerCase();
  if (VERIFIED_STATUSES.has(normalized)) return "verified";
  if (PENDING_STATUSES.has(normalized)) return "pending";
  if (REJECTED_STATUSES.has(normalized)) return "rejected";
  return "unverified";
}

export function affiliateStatusForSaleGate(input: {
  ownerType: "automatize" | "expert";
  affiliateStatus: VindiAffiliateStatus | null | undefined;
}): VindiAffiliateStatus | null {
  return (
    input.affiliateStatus ??
    (input.ownerType === "expert" ? "unverified" : null)
  );
}

export type AffiliateReadinessAudience = "admin" | "expert";

function unreadiness(
  code: ExpertProductSaleGateCode,
  audience: AffiliateReadinessAudience,
): Extract<ExpertAffiliateReadiness, { ready: false }> {
  const copy =
    audience === "expert" ? EXPERT_SALE_GATE_COPY : ADMIN_SALE_GATE_COPY;
  return { ready: false, code, ...copy[code] };
}

export function describeExpertAffiliateReadiness(
  status: VindiAffiliateStatus | null,
  audience: AffiliateReadinessAudience = "admin",
): ExpertAffiliateReadiness {
  if (status === "verified") return { ready: true };
  if (status === "pending") return unreadiness("affiliate_pending", audience);
  if (status === "rejected") return unreadiness("affiliate_rejected", audience);
  return unreadiness("affiliate_missing", audience);
}

export function evaluateExpertProductSaleGate(
  input: ExpertProductSaleGateInput,
): ExpertProductSaleGate {
  if (
    !input.vindiProductsEnabled ||
    !input.offeringForSale ||
    input.ownerType === "automatize"
  ) {
    return { allowed: true };
  }

  const readiness = describeExpertAffiliateReadiness(
    affiliateStatusForSaleGate({
      ownerType: input.ownerType,
      affiliateStatus: input.affiliateStatus,
    }),
  );
  if (readiness.ready) return { allowed: true };
  return {
    allowed: false,
    code: readiness.code,
    message: readiness.message,
    missing: readiness.missing,
  };
}

export function formatExpertSaleGateError(
  gate: Extract<ExpertProductSaleGate, { allowed: false }>,
): string {
  return `${gate.message} ${gate.missing}`;
}

export function isProductOfferedForSale(input: {
  status: "draft" | "published" | "archived";
  salesEnabled: boolean;
}): boolean {
  return input.status === "published" && input.salesEnabled;
}

/** Catalog/API view of `salesEnabled` after the affiliate gate. Flag OFF
 * leaves the stored flag alone (aceite 1). Flag ON hides expert products
 * that cannot sell yet (aceite 2). */
export function catalogSalesEnabled(input: {
  salesEnabled: boolean;
  status: "draft" | "published" | "archived";
  ownerType: "automatize" | "expert";
  affiliateStatus: VindiAffiliateStatus | null;
  vindiProductsEnabled: boolean;
}): boolean {
  if (!input.salesEnabled) return false;
  return evaluateExpertProductSaleGate({
    ownerType: input.ownerType,
    affiliateStatus: input.affiliateStatus,
    vindiProductsEnabled: input.vindiProductsEnabled,
    offeringForSale: isProductOfferedForSale({
      status: input.status,
      salesEnabled: input.salesEnabled,
    }),
  }).allowed;
}

export const VINDI_AFFILIATE_STATUS_LABELS: Record<
  VindiAffiliateStatus,
  string
> = {
  unverified: "Sem afiliado",
  pending: "Verificação pendente",
  verified: "Verificado",
  rejected: "Não verificado",
};
