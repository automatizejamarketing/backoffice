import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { getCarteiraData } from "@/components/consultant-workspace/carteira/server-data";
import { parseDays } from "@/components/consultant-workspace/common/routes";
import type { CarteiraPayload } from "@/components/consultant-workspace/common/trafego-query";

export const dynamic = "force-dynamic";

/**
 * Fila e Mesa: a carteira de um período (`dias` = 7, 14 ou 30), do jeito que a
 * página passava, mais o relógio da leitura. Só SELECT; nada da Graph API. O
 * consultor comum recebe só a própria carteira.
 */
export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("marketing:read");
  if (!authz.ok) return authz.response;
  const days = parseDays(new URL(request.url).searchParams.get("dias"));
  try {
    const data = await getCarteiraData(authz.actor, days);
    const payload: CarteiraPayload = { ...data, now: Date.now() };
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[consultant-workspace] carteira read failed", error);
    return NextResponse.json({ error: "Não deu para ler a carteira. Tente de novo." }, { status: 500 });
  }
}
