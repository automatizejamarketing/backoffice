import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export type InternalAuthResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

function secretsMatch(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function assertMatReportAuthorized(request: Request): InternalAuthResult {
  const secret = process.env.MAT_PERFORMANCE_REPORT_SECRET?.trim();
  if (!secret) {
    console.error("[mat-performance-report] MAT_PERFORMANCE_REPORT_SECRET is not configured");
    return {
      ok: false,
      response: NextResponse.json(
        { error: "MAT_PERFORMANCE_REPORT_SECRET environment variable is not configured" },
        { status: 500 },
      ),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix) || !secretsMatch(secret, header.slice(prefix.length))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true };
}
