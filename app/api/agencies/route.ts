import { NextResponse } from "next/server";
import { createAgency, listManagedAgencies } from "@/lib/agency/agencies";
import { agencyActor, agencyErrorResponse, readJson, str } from "./http";

export const dynamic = "force-dynamic";

/** GET: agências que a pessoa gere. POST { name, ownerEmail, ownerName? }: admin cria agência e Dono. */
export async function GET() {
  const auth = await agencyActor();
  if ("response" in auth) return auth.response;
  return NextResponse.json({ agencies: await listManagedAgencies(auth.actor) });
}

export async function POST(request: Request) {
  const auth = await agencyActor();
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  try {
    const agency = await createAgency(auth.actor, { name: str(body.name), ownerEmail: str(body.ownerEmail), ownerName: str(body.ownerName) || null });
    return NextResponse.json({ agency }, { status: 201 });
  } catch (error) {
    return agencyErrorResponse(error);
  }
}
