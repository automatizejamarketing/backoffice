import type { PlanType } from "@/lib/db/schema";
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import { centavosToVindiAmount } from "./money";

export function quoteBackofficeVindiPixAmount(planType: PlanType): number {
  return PLAN_DEFINITIONS[planType].totalCommitmentCentavos;
}

export type VindiPixQrBillRequest = {
  customer_id: number;
  payment_method_code: string;
  bill_items: Array<{
    product_id: number;
    amount: string;
    description: string;
  }>;
  metadata: {
    purpose: "subscription";
    payment_method: "pix_qr";
    app_user_id: string;
    plan_type: PlanType;
  };
};

export function buildVindiPixQrBillRequest(input: {
  customerId: number;
  productId: number;
  pixMethodCode: string;
  appUserId: string;
  planType: PlanType;
}): VindiPixQrBillRequest {
  if (!input.pixMethodCode.trim()) {
    throw new Error("Pix payment method code is required");
  }
  const amountCentavos = quoteBackofficeVindiPixAmount(input.planType);
  return {
    customer_id: input.customerId,
    payment_method_code: input.pixMethodCode,
    bill_items: [
      {
        product_id: input.productId,
        amount: centavosToVindiAmount(amountCentavos),
        description: PLAN_DEFINITIONS[input.planType].name,
      },
    ],
    metadata: {
      purpose: "subscription",
      payment_method: "pix_qr",
      app_user_id: input.appUserId,
      plan_type: input.planType,
    },
  };
}
