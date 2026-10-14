import { NextResponse } from "next/server";
import { addAgencyPerson, removeAgencyPerson } from "@/lib/agency/agencies";
import { agencyActor, agencyErrorResponse, readJson, str } from "../../http";

export const dynamic = "force-dynamic";

/** POST { email, name?, role }: dá acesso ao backoffice como Dono ou Membro. DELETE { personId }: tira. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await agencyActor();
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  const role = body.role === "agency_owner" ? "agency_owner" : "agency_member";
  try {
    const person = await addAgencyPerson(auth.actor, (await params).id, { email: str(body.email), name: str(body.name) || null, role });
    return NextResponse.json({ person }, { status: 201 });
  } catch (error) {
    return agencyErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await agencyActor();
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  try {
    await removeAgencyPerson(auth.actor, (await params).id, str(body.personId));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return agencyErrorResponse(error);
  }
}
