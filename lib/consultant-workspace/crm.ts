/**
 * CRM da área de Tráfego: uma coluna por responsável operacional e a regra
 * que decide em qual coluna cada cliente cai. Puro, sem banco nem React.
 *
 * - Plano vencido, pagamento atrasado ou cancelado → Gui (reativar/regularizar),
 *   mesmo que o cliente tenha outro responsável salvo: sai do fluxo de tráfego.
 * - Responsável salvo (arrastar o card ou passar com tarefa) → ele.
 * - Sem responsável: onboarding → Fred; Premium → Comelli; o resto → Lucas.
 */
import type { AccessSegment } from "./access";
import type { JourneyStage } from "./journey";
import type { MatDraft } from "./playbook-actions";
import type { PlanTier } from "./types";

export type CrmOwnerKey = "fred" | "gui" | "lucas" | "comelli";

export type CrmOwner = {
  key: CrmOwnerKey;
  label: string;
  /** Login do backoffice (`backoffice_users.email`). */
  email: string;
  /** O que cai na coluna sem ninguém atribuir. */
  role: string;
};

export const CRM_OWNERS: CrmOwner[] = [
  { key: "fred", label: "Fred", email: "fredsader@automatizemarketing.com", role: "Onboarding" },
  { key: "gui", label: "Gui", email: "barretonovaes.vilas@gmail.com", role: "Reativação e regularização" },
  { key: "lucas", label: "Lucas", email: "lucashaddadm@gmail.com", role: "Tráfego (Starter e Pro)" },
  { key: "comelli", label: "Comelli", email: "comelliworking@gmail.com", role: "Tráfego Premium" },
];

const BY_KEY = new Map(CRM_OWNERS.map((owner) => [owner.key, owner]));
const BY_EMAIL = new Map(CRM_OWNERS.map((owner) => [owner.email, owner]));

export function crmOwner(key: string | null | undefined): CrmOwner | null {
  return (key && BY_KEY.get(key as CrmOwnerKey)) || null;
}

export function crmOwnerByEmail(email: string | null | undefined): CrmOwner | null {
  return (email && BY_EMAIL.get(email.trim().toLowerCase())) || null;
}

export function isCrmOwnerEmail(email: string | null | undefined) {
  return crmOwnerByEmail(email) != null;
}

/** Acesso que tira o cliente do fluxo de tráfego e manda para o Gui. */
const REGULARIZE: readonly AccessSegment[] = ["expirado", "inadimplente", "cancelado"];

export function needsRegularization(access: AccessSegment) {
  return REGULARIZE.includes(access);
}

/** Dono forçado pelo acesso (hoje só o Gui); null quando o acesso não decide. */
export function crmOwnerByAccess(access: AccessSegment): CrmOwnerKey | null {
  return needsRegularization(access) ? "gui" : null;
}

export type CrmPlacement = {
  owner: CrmOwnerKey;
  /** auto = regra (ninguém atribuiu); salvo = responsável no banco; acesso = vencido/atrasado vai para o Gui. */
  reason: "auto" | "salvo" | "acesso";
};

export function crmPlacement(input: {
  access: AccessSegment;
  assignedEmail: string | null;
  stage: JourneyStage;
  tier: PlanTier;
}): CrmPlacement {
  const forced = crmOwnerByAccess(input.access);
  if (forced) return { owner: forced, reason: "acesso" };
  const saved = crmOwnerByEmail(input.assignedEmail);
  if (saved) return { owner: saved.key, reason: "salvo" };
  if (input.stage === "onboarding") return { owner: "fred", reason: "auto" };
  if (input.tier === "premium") return { owner: "comelli", reason: "auto" };
  return { owner: "lucas", reason: "auto" };
}

/** O card pode ir para esta coluna? Vencidos ficam com o Gui até regularizar. */
export function canMoveTo(access: AccessSegment, to: CrmOwnerKey): boolean {
  return !needsRegularization(access) || to === "gui";
}

/* ------------------------------------------------------------------ */
/* Status do plano no card                                             */
/* ------------------------------------------------------------------ */

export type PlanStatusTone = "ok" | "warn" | "bad" | "muted";

const DAY = 86_400_000;

function shortDate(iso: string) {
  const date = new Date(iso);
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysBetween(fromIso: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / DAY));
}

/** "Ativo · em dia", "Trial", "Expirado há 5 dias"… e as datas que importam. */
export function planStatus(
  client: {
    access: AccessSegment;
    accessUntil: string | null;
    plan: { startedAt: string | null; customerSince: string | null; renewalAt: string | null };
  },
  now: number,
): { label: string; tone: PlanStatusTone; dates: string | null } {
  const { access, accessUntil, plan } = client;
  const until = accessUntil ? shortDate(accessUntil) : null;
  const since = plan.customerSince ?? plan.startedAt;
  switch (access) {
    case "pagante":
      return {
        label: "Ativo · em dia",
        tone: "ok",
        dates: [since ? `assina desde ${shortDate(since)}` : null, until ? `pago até ${until}` : null]
          .filter(Boolean)
          .join(" · ") || null,
      };
    case "trial":
      return {
        label: "Trial",
        tone: "warn",
        dates: [plan.startedAt ? `trial desde ${shortDate(plan.startedAt)}` : null, until ? `vence ${until}` : null]
          .filter(Boolean)
          .join(" · ") || null,
      };
    case "manual":
      return { label: "Acesso manual", tone: "muted", dates: until ? `liberado até ${until}` : null };
    case "cancelado":
      return { label: "Cancelado", tone: "warn", dates: until ? `acesso até ${until}` : null };
    case "inadimplente":
      return {
        label: "Pagamento atrasado",
        tone: "bad",
        dates: accessUntil ? `venceu ${until} (${daysBetween(accessUntil, now)} d)` : null,
      };
    case "expirado": {
      const days = accessUntil ? daysBetween(accessUntil, now) : null;
      return {
        label: days != null ? `Expirado há ${days === 1 ? "1 dia" : `${days} dias`}` : "Expirado",
        tone: "bad",
        dates: until ? `venceu ${until}` : null,
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Estágio do cliente no card                                          */
/* ------------------------------------------------------------------ */

export type CrmHealth = "erro" | "parado" | "onboarding" | "recomendacao" | "ok" | "regularizar";

export const CRM_HEALTH_LABEL: Record<CrmHealth, string> = {
  regularizar: "Regularizar plano",
  erro: "Com erro",
  parado: "Campanha parada",
  onboarding: "Onboarding",
  recomendacao: "Recomendação do Mat",
  ok: "Tudo 100% ok",
};

/** Ordem dos grupos dentro da coluna: o que pede ação primeiro. */
export const CRM_HEALTH_ORDER: CrmHealth[] = ["regularizar", "erro", "parado", "onboarding", "recomendacao", "ok"];

export function crmHealth(input: {
  access: AccessSegment;
  stage: JourneyStage;
  metaBroken: boolean;
  publishHolds: number;
  criticalStep: boolean;
  matRecommendations: number;
}): CrmHealth {
  if (needsRegularization(input.access)) return "regularizar";
  if (input.metaBroken || input.publishHolds > 0 || input.criticalStep) return "erro";
  if (input.stage === "parado") return "parado";
  if (input.stage === "onboarding") return "onboarding";
  if (input.matRecommendations > 0) return "recomendacao";
  return "ok";
}

/* ------------------------------------------------------------------ */
/* Mensagem pela Mat a partir do card                                  */
/* ------------------------------------------------------------------ */

/** Tag de problema do erro de não discriminação da Meta (ver `journey.ts`). */
const DISCRIMINATION_TAG = "certificacao_meta";

/**
 * O que a Mat pode mandar direto do card: reativar (vencido/cancelado),
 * regularizar (pagamento atrasado) ou liberar a conta na Meta (não
 * discriminação). O gestor revisa o texto antes; nada sai sozinho.
 */
export function crmMatDraft(input: { access: AccessSegment; firstName: string | null; tags: string[] }): MatDraft | null {
  const hi = input.firstName ? `Oi, ${input.firstName}!` : "Oi!";
  if (input.access === "expirado" || input.access === "cancelado") {
    return {
      kind: "plan_reactivation",
      title: "Seu plano da Automatize",
      message: `${hi} Vimos que o seu plano da Automatize ${input.access === "cancelado" ? "foi cancelado" : "venceu"} e as suas campanhas ficaram sem acompanhamento. Quer voltar? É só reativar o plano no app — suas campanhas, criativos e histórico continuam lá. Se tiver qualquer dúvida, responde aqui que eu te ajudo.`,
    };
  }
  if (input.access === "inadimplente") {
    return {
      kind: "plan_regularization",
      title: "Pagamento do seu plano",
      message: `${hi} A última cobrança do seu plano da Automatize não passou, e o acesso pode ser interrompido. Para regularizar, é só atualizar a forma de pagamento em Assinatura, no app. Se precisar de ajuda, responde aqui.`,
    };
  }
  if (input.tags.includes(DISCRIMINATION_TAG)) {
    return {
      kind: "meta_discrimination",
      title: "Liberar seus anúncios na Meta",
      message: `${hi} Seus anúncios estão prontos, mas a Meta pediu uma confirmação de política (não discriminação) para liberar a conta. É rápido: abra Marketing na Automatize e faça o login com o seu Facebook pessoal no aviso que aparece. Assim que fizer, os anúncios sobem sozinhos.`,
    };
  }
  return null;
}
