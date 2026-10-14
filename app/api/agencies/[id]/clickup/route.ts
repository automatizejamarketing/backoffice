import { NextResponse } from "next/server";
import { connectionView, disconnect, saveMapping } from "@/lib/clickup/connect";
import { resolveIssuer } from "@/lib/mcp-oauth/http";
import { agencyActor, clickupError, readJson } from "../../http";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await agencyActor();
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json(await connectionView(auth.actor, (await params).id));
  } catch (error) {
    return clickupError(error);
  }
}

/** PUT: salva o mapeamento da Lista de Publicação e registra o webhook. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await agencyActor();
  if ("response" in auth) return auth.response;
  try {
    await saveMapping(auth.actor, (await params).id, await readJson(request), resolveIssuer(request.headers));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return clickupError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await agencyActor();
  if ("response" in auth) return auth.response;
  try {
    await disconnect(auth.actor, (await params).id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return clickupError(error);
  }
}

