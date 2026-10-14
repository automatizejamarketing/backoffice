import { PlaybooksScreen } from "@/components/consultant-workspace/jornada/board-screen";

// O acesso é checado no layout de /trafego; a página não lê nada no servidor.
export const dynamic = "force-dynamic";

export const metadata = { title: "Playbooks · Tráfego" };

/** Mesma leitura (e mesmo cache) da Jornada. */
export default function TrafegoPlaybooksPage() {
  return <PlaybooksScreen />;
}
