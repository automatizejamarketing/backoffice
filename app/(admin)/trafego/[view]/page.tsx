import { notFound, redirect } from "next/navigation";
import { TrafegoViews } from "@/components/consultant-workspace/common/trafego-views";
import { TRAFEGO_VIEWS, viewFromSegment } from "@/components/consultant-workspace/common/routes";

// O acesso é checado no layout de /trafego; a página não lê nada no servidor.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  const label = TRAFEGO_VIEWS.find((entry) => entry.key === viewFromSegment(view))?.label;
  return { title: label ? `${label} · Tráfego` : "Tráfego" };
}

/**
 * Mesa e CRM numa rota só: trocar entre elas muda só a URL no
 * navegador (sem ida ao servidor) e pinta do cache do react-query — é o que
 * deixa a troca instantânea. Outras rotas (cliente, playbooks…) navegam normal.
 */
export default async function TrafegoViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ view }, query] = await Promise.all([params, searchParams]);
  const target = TRAFEGO_VIEWS.find((entry) => entry.key === viewFromSegment(view));
  if (!target) notFound();
  // Links antigos: /trafego/jornada → /trafego/crm; /trafego/fila (saiu) → /trafego/mesa.
  if (target.href !== `/trafego/${view}`) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      for (const item of Array.isArray(value) ? value : value != null ? [value] : []) search.append(key, item);
    }
    redirect(search.size ? `${target.href}?${search}` : target.href);
  }
  return <TrafegoViews />;
}
