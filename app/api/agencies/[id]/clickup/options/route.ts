import { NextResponse, type NextRequest } from "next/server";
import { mappingOptions } from "@/lib/clickup/connect";
import { agencyActor, clickupError } from "../../../http";

export const dynamic = "force-dynamic";

/** GET ?teamId=&listId= — workspaces, listas, campos, status e tipos de tarefa para o mapeamento. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await agencyActor();
  if ("response" in auth) return auth.response;
  const query = { teamId: request.nextUrl.searchParams.get("teamId") ?? undefined, listId: request.nextUrl.searchParams.get("listId") ?? undefined };
  try {
    return NextResponse.json(await mappingOptions(auth.actor, (await params).id, query));
  } catch (error) {
    return clickupError(error);
  }
}
