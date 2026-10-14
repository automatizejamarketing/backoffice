import { NextResponse } from "next/server";
import { addAgencyClient, removeAgencyClient } from "@/lib/agency/agencies";
import { agencyActor, agencyErrorResponse, readJson, str } from "../../http";

export const dynamic = "force-dynamic";

/** POST { email }: liga a conta à agência. DELETE { userId }: desliga (não apaga dados). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await agencyActor();
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  try {
    const client = await addAgencyClient(auth.actor, (await params).id, str(body.email));
    return NextResponse.json({ client }, { status: 201 });
  } catch (error) {
    return agencyErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await agencyActor();
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  try {
    await removeAgencyClient(auth.actor, (await params).id, str(body.userId));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return agencyErrorResponse(error);
  }
}
