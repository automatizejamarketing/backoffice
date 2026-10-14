import { Suspense } from "react";
import { JourneyBoardScreen } from "@/components/consultant-workspace/jornada/board-screen";
import { BoardSkeleton } from "@/components/consultant-workspace/jornada/skeletons";

// O acesso é checado no layout de /trafego; a página não lê nada no servidor.
export const dynamic = "force-dynamic";

export const metadata = { title: "Jornada · Tráfego" };

/** Página fina: o quadro vem de /api/consultant-workspace/board pelo cache do navegador (react-query). */
export default function TrafegoJornadaPage() {
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <JourneyBoardScreen />
    </Suspense>
  );
}
