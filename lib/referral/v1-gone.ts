import { NextResponse } from "next/server";

// Lápide do programa de afiliados v1 (ticket 15, ADR 0024).
//
// `/api/affiliates` e tudo sob ele — approve, reject, block, reactivate,
// create, conversions, [id], [id]/code — saíram do ar no cutover. Eram as
// únicas telas capazes de escrever nas tabelas do v1; enquanto existissem,
// "nenhuma escrita nova chega às tabelas do v1" dependeria de ninguém clicar.
//
// 410 Gone, e não 404: o recurso existiu, foi retirado deliberadamente e não
// volta. Um 404 se confunde com erro de roteamento; um handler meio desligado
// devolveria 500. O programa vivo é o v2, sob `/api/referrals/*`.
//
// As tabelas do v1 (`affiliates`, `affiliate_clicks`, `affiliate_conversions`,
// `affiliate_action_logs`) continuam no banco, intactas. Nada aqui as lê ou
// escreve.

export const AFFILIATE_PROGRAM_V1_GONE_BODY = {
  error: "affiliate_program_v1_discontinued",
  message:
    "O programa de afiliados v1 foi descontinuado. Use /api/referrals/* (programa v2).",
} as const;

export function affiliateProgramV1GoneResponse(): NextResponse {
  return NextResponse.json(AFFILIATE_PROGRAM_V1_GONE_BODY, { status: 410 });
}
