import "server-only";

import { markVindiPaidOutOfBand } from "./paid-out-of-band";
import { createDbVindiPaidOutOfBandStore } from "./paid-out-of-band-store";
import { createPrivateVindiClient } from "./private";

export async function markVindiPaidOutOfBandForUser(input: {
  userId: string;
  adminEmail: string;
}) {
  return markVindiPaidOutOfBand({
    client: createPrivateVindiClient(),
    store: createDbVindiPaidOutOfBandStore(),
    userId: input.userId,
    adminEmail: input.adminEmail,
    now: new Date(),
  });
}
