import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export function assertClientReportsAuthorized(request: Request) {
  const expected = process.env.CLIENT_REPORTS_INTERNAL_SECRET?.trim();
  const header = request.headers.get("authorization") ?? "";
  const received = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Geração interna de relatórios não configurada." },
        { status: 503 },
      ),
    };
  }
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true as const };
}
