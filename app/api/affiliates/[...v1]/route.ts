import { NextResponse } from "next/server";

import { affiliateProgramV1GoneResponse } from "@/lib/referral/v1-gone";

// Lápide do programa de afiliados v1 (ticket 15, ADR 0024). Ver
// `lib/referral/v1-gone.ts` para o porquê de 410 e não 404.
export function GET(): NextResponse {
  return affiliateProgramV1GoneResponse();
}

export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
