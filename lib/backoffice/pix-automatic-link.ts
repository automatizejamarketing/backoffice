import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import type { PlanType } from "@/lib/db/schema";

export function pixAutomaticLink(planType: PlanType, origin: string) {
  const plan = PLAN_DEFINITIONS[planType];
  const url = new URL("/app/assinar-plano", origin);
  url.searchParams.set("plan", planType);
  url.searchParams.set("method", "pix_automatic");
  const period = plan.commitmentMonths === 1 ? "por mês" : `a cada ${plan.commitmentMonths} meses`;
  const amount = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(plan.totalCommitmentCentavos / 100);
  return { url: url.toString(), price: `${amount} ${period}`, planName: plan.name };
}
