import "server-only";

import {
  createVindiClient,
  type CreateVindiClientOptions,
  type VindiClient,
} from "./client";

export function createPrivateVindiClient(
  options?: Pick<CreateVindiClientOptions, "fetch" | "sleep">,
): VindiClient {
  const apiKey = process.env.VINDI_API_KEY;
  const baseUrl = process.env.VINDI_API_BASE_URL;
  if (!apiKey) {
    throw new Error("VINDI_API_KEY is not configured");
  }
  if (!baseUrl) {
    throw new Error("VINDI_API_BASE_URL is not configured");
  }

  return createVindiClient({
    keyKind: "private",
    apiKey,
    baseUrl,
    ...options,
  });
}
