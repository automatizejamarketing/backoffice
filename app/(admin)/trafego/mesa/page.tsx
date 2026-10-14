import { requirePagePermission } from "@/lib/auth/rbac";
import { Carteira } from "@/components/consultant-workspace/carteira/carteira";
import { getCarteiraData } from "@/components/consultant-workspace/carteira/server-data";
import { parseDays } from "@/components/consultant-workspace/common/routes";

export const dynamic = "force-dynamic";

export const metadata = { title: "Mesa · Tráfego" };

function serverNow() {
  return Date.now();
}

/**
 * Uma leitura por período. Filtros, busca e ordem mudam só no navegador (a
 * URL guarda o estado); a Fila e a Mesa leem a mesma query string.
 */
export default async function TrafegoMesaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [actor, params] = await Promise.all([requirePagePermission("marketing:read"), searchParams]);
  const data = await getCarteiraData(actor, parseDays(params.dias));
  return <Carteira data={data} now={serverNow()} mode="tabela" />;
}
