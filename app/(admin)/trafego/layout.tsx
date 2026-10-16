import { Suspense } from "react";
import { cookies } from "next/headers";
import { requirePagePermission } from "@/lib/auth/rbac";
import { TrafegoTopBar } from "@/components/consultant-workspace/common/top-bar";
import { VIEW_COOKIE, isTrafegoView } from "@/components/consultant-workspace/common/routes";
import { WorkspaceMeProvider } from "@/components/consultant-workspace/common/workspace-context";

export const dynamic = "force-dynamic";

/**
 * Área de Tráfego: três visões da mesma carteira (Fila, Mesa, Jornada) mais
 * Playbooks e Mensagens. Ocupa a altura toda abaixo do cabeçalho do admin;
 * cada tela rola por dentro.
 */
export default async function TrafegoLayout({ children }: { children: React.ReactNode }) {
  const [actor, cookieStore] = await Promise.all([requirePagePermission("marketing:read"), cookies()]);
  const saved = cookieStore.get(VIEW_COOKIE)?.value;
  return (
    <WorkspaceMeProvider me={{ id: actor.id, email: actor.email, name: actor.name ?? null, role: actor.role }}>
      <div className="-mx-4 -mt-6 -mb-4 flex h-[calc(100svh-3.5rem)] min-w-0 flex-col md:-m-8">
        <Suspense fallback={<div className="h-12 shrink-0 border-b" />}>
          <TrafegoTopBar defaultView={isTrafegoView(saved) ? saved : null} />
        </Suspense>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </div>
    </WorkspaceMeProvider>
  );
}
