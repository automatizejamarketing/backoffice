import "server-only";

import { createPrivateVindiClient } from "./private";
import { cancelVindiSubscription } from "./subscription-cancel-charge";
import { createDbVindiCancelStore } from "./subscription-cancel-store";

export async function cancelVindiSubscriptionForUser(input: {
  userId: string;
  adminEmail: string;
}) {
  return cancelVindiSubscription({
    client: createPrivateVindiClient(),
    store: createDbVindiCancelStore(),
    userId: input.userId,
    adminEmail: input.adminEmail,
    now: new Date(),
  });
}
