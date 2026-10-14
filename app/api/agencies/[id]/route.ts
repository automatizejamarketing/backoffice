import { NextResponse } from "next/server";
import { getAgencyDetail } from "@/lib/agency/agencies";
import { agencyActor, agencyErrorResponse } from "../http";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await agencyActor();
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json(await getAgencyDetail(auth.actor, (await params).id));
  } catch (error) {
    return agencyErrorResponse(error);
  }
}
