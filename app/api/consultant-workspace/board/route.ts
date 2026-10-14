import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { getBoardData } from "@/components/consultant-workspace/jornada/server-data";
import type { BoardPayload } from "@/components/consultant-workspace/common/trafego-query";

export const dynamic = "force-dynamic";

/**
 * Jornada e Playbooks: o quadro (sempre 7 dias), do jeito que a página passava,
 * mais o relógio da leitura. Só SELECT; nada da Graph API. O consultor comum
 * recebe só a própria carteira.
 */
export async function GET() {
  const authz = await requireBackofficePermissionResponse("marketing:read");
  if (!authz.ok) return authz.response;
  try {
    const data = await getBoardData(authz.actor);
    const payload: BoardPayload = { ...data, now: Date.now() };
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[consultant-workspace] board read failed", error);
    return NextResponse.json({ error: "Não deu para ler o quadro. Tente de novo." }, { status: 500 });
  }
}
