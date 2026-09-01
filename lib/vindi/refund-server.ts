import "server-only";

import { createPrivateVindiClient } from "./private";
import { refundVindiPayment } from "./refund";
import { createDbVindiRefundStore } from "./refund-store";

export async function refundVindiPaymentForUser(input: {
  userId: string;
  paymentId: string;
  adminEmail: string;
}) {
  return refundVindiPayment({
    client: createPrivateVindiClient(),
    store: createDbVindiRefundStore(),
    userId: input.userId,
    paymentId: input.paymentId,
    adminEmail: input.adminEmail,
    now: new Date(),
  });
}
