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
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          CRM
        </h1>
      </header>
      <CrmWorkspace />
    </div>
  );
}
