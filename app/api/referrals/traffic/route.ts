import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  parseReferralTrafficRange,
  trafficRangeToDays,
} from "@/lib/referral/traffic";
import {
  getReferralTrafficReport,
  parseTrafficAffiliateId,
} from "@/lib/referral/traffic-queries";

/**
 * O painel de tráfego do programa de afiliados v2: de onde vêm os cliques.
 *
 * Uma resposta só com todos os painéis (fontes, referrers, páginas, UTM,
 * dispositivos, navegadores, SO, robôs) porque todos são recortes da MESMA
 * lista de cliques — servi-los separados deixaria um painel somar um total que
 * outro não explica.
 *
 * Período e afiliado chegam por query string; valores inválidos degradam para
 * o padrão (30 dias, todos os afiliados) em vez de erro — o painel é leitura,
 * e um filtro rabiscado não merece um 500.
 */
export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;

  try {
    const { searchParams } = new URL(request.url);
    const range = parseReferralTrafficRange(searchParams.get("range"));
    const affiliateId = parseTrafficAffiliateId(searchParams.get("affiliate"));
    const report = await getReferralTrafficReport({
      days: trafficRangeToDays(range),
      affiliateId,
    });
    return NextResponse.json(report);
  } catch (error) {
    console.error("[referral] failed to compute traffic report", error);
    return NextResponse.json(
      { error: "Erro ao carregar o tráfego dos afiliados" },
      { status: 500 },
    );
  }
}
