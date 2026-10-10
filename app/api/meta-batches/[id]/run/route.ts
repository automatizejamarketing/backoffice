import { NextResponse, type NextRequest } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { runMetaBatch } from "@/lib/mcp/meta-batch";

/** Um lote para de começar itens aos 150 s; um item pode levar ~75 s (retry de objeto ocupado da Meta). */
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/meta-batches/[id]/run — aprova e executa (ou continua) um lote preparado pelo MCP.
 * É o único caminho que muda a Meta: roda com a sessão da pessoa no navegador, que a IA não tem.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authz = await requireBackofficePermissionResponse("marketing:write");
  if (!authz.ok) return authz.response;
  // Formulário de outro site não manda JSON sem preflight de CORS.
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Envie como JSON." }, { status: 415 });
  }
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Lote não encontrado." }, { status: 404 });
  try {
    return NextResponse.json(await runMetaBatch(authz.actor, id));
  } catch (error) {
    console.error("[meta-batch] execução recusada ou interrompida", id, error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível executar o lote." }, { status: 409 });
  }
}
