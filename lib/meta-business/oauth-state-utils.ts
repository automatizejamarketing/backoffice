import { createHash } from "node:crypto";

export function hashOauthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}
