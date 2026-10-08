import { createHmac } from "node:crypto";

/** Binds a send confirmation to the exact campaign revision, time and audience shown in the preview. */
export function sendConfirmationCode(input: { campaignId: string; revision: string; scheduledAt: string | null; userIds: string[] }, secret: string): string {
  const payload = JSON.stringify([input.campaignId, input.revision, input.scheduledAt ?? "now", [...input.userIds].sort()]);
  return createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 16);
}
