import { Suspense } from "react";
import { CarteiraScreen } from "@/components/consultant-workspace/carteira/carteira-screen";
import { CarteiraSkeleton } from "@/components/consultant-workspace/carteira/skeletons";

// O acesso é checado no layout de /trafego; a página não lê nada no servidor.
export const dynamic = "force-dynamic";

export const metadata = { title: "Mesa · Tráfego" };

/**
 * Página fina: a carteira vem de /api/consultant-workspace/carteira pelo cache
 * do navegador (react-query), então trocar de visão não recalcula nada no
 * servidor. Filtros, busca, ordem e período ficam na URL.
 */
export default function TrafegoMesaPage() {
  return (
    <Suspense fallback={<CarteiraSkeleton mode="tabela" />}>
      <CarteiraScreen mode="tabela" />
    </Suspense>
  );
}
