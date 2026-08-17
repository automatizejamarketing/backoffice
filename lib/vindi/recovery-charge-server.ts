import "server-only";

import { getVindiPixMethodCode } from "./config";
import { createPrivateVindiClient } from "./private";
import {
  recoverVindiPayment,
  type VindiBackofficeRecoveryMode,
} from "./recovery-charge";
import { createDbVindiRecoveryStore } from "./recovery-store";

export async function recoverVindiPaymentForUser(input: {
  userId: string;
  adminEmail: string;
  mode: VindiBackofficeRecoveryMode;
}) {
  return recoverVindiPayment({
    client: createPrivateVindiClient(),
    store: createDbVindiRecoveryStore(),
    userId: input.userId,
    adminEmail: input.adminEmail,
    mode: input.mode,
    pixMethodCode: getVindiPixMethodCode(),
    now: new Date(),
  });
}
