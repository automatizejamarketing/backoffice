import { NextResponse } from "next/server";

export type CronAuthResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

/**
 * Require `Authorization: Bearer ${CRON_SECRET}` for cron routes.
 * Returns a 500 when the secret is unset, 401 when the header mismatches.
 */
export function assertCronAuthorized(
  request: Request,
  logPrefix = "[cron]",
): CronAuthResult {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error(`${logPrefix} CRON_SECRET is not configured`);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "CRON_SECRET environment variable is not configured" },
        { status: 500 },
      ),
    };
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true };
}
