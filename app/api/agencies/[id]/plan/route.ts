import { NextResponse } from "next/server";
import { setAgencyPlan, agencyPaymentUrl } from "@/lib/agency/plan";
import { resolveIssuer } from "@/lib/mcp-oauth/http";
import { agencyActor, agencyErrorResponse, readJson } from "../../http";

export const dynamic = "force-dynamic";

/** PUT { unitAmount: "249,90", clientLimit }: o admin define o plano. POST: link para pagar (checkout ou fatura em atraso). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await agencyActor();
  if ("response" in auth) return auth.response;
  try {
    await setAgencyPlan(auth.actor, (await params).id, await readJson(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return agencyErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await agencyActor();
  if ("response" in auth) return auth.response;
  try {
    const url = await agencyPaymentUrl(auth.actor, (await params).id, resolveIssuer(request.headers));
    return NextResponse.json({ url });
  } catch (error) {
    return agencyErrorResponse(error);
  }
}
