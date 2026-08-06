import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { parseReferralMetricSort } from "@/lib/referral/metrics";
import { getReferralProgramMetrics } from "@/lib/referral/metrics-queries";

/**
 * As métricas e os alertas do programa de afiliados v2 (ticket 14).
 *
 * Tudo numa resposta só, e não uma rota por número: o passivo, a margem e a
 * concentração são recortes da MESMA foto do banco, e servi-los de consultas
 * separadas deixaria a tela mostrar um total que não bate com as linhas por
 * causa de uma comissão liberada entre uma requisição e a outra.
 *
 * A ordenação vem por query string porque ela é a pergunta que o operador está
 * fazendo — "quem traz dinheiro" e "quem dá prejuízo" são a mesma tabela vista
 * de dois ângulos.
 */
export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;

  try {
    const { searchParams } = new URL(request.url);
    const sort = parseReferralMetricSort(searchParams.get("sort"));
    const metrics = await getReferralProgramMetrics({ sort });
    return NextResponse.json(metrics);
  } catch (error) {
    console.error("[referral] failed to compute program metrics", error);
    return NextResponse.json(
      { error: "Erro ao carregar as métricas do programa" },
      { status: 500 },
    );
  }
}
