import { requirePagePermission } from "@/lib/auth/rbac";
import { CrmWorkspace } from "./crm-workspace";

// Lista viva de usuários com subconsultas: dinâmico para não estourar o
// tempo de build na Vercel.
export const dynamic = "force-dynamic";

export default async function CrmPage() {
  await requirePagePermission("users:manage");

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <header>
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="size-1.5 rounded-full bg-chart-3" />
          Comercial
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          CRM
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Funil comercial de cada conta, independente do status de acesso.
          Arraste o lead entre as colunas ou abra para anotar o contato.
        </p>
      </header>
      <CrmWorkspace />
    </div>
  );
}
