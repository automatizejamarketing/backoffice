import { notFound } from "next/navigation";
import { TrafegoViews } from "@/components/consultant-workspace/common/trafego-views";
import { isTrafegoView, TRAFEGO_VIEWS } from "@/components/consultant-workspace/common/routes";

// O acesso é checado no layout de /trafego; a página não lê nada no servidor.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  const label = TRAFEGO_VIEWS.find((entry) => entry.key === view)?.label;
  return { title: label ? `${label} · Tráfego` : "Tráfego" };
}

/**
 * Fila, Mesa e Jornada numa rota só: trocar entre elas muda só a URL no
 * navegador (sem ida ao servidor) e pinta do cache do react-query — é o que
 * deixa a troca instantânea. Outras rotas (cliente, playbooks…) navegam normal.
 */
export default async function TrafegoViewPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!isTrafegoView(view)) notFound();
  return <TrafegoViews />;
}
