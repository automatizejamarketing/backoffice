import { ShieldCheck } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { loginUrlWithReturn } from "@/lib/auth/login-return";
import { getCurrentBackofficeActor } from "@/lib/auth/rbac";
import { MCP_SCOPE_WRITE, buildRedirect } from "@/lib/mcp-oauth/core";
import { resolveAuthorizeRequest } from "@/lib/mcp-oauth/http";
import { decideAuthorization } from "./actions";

type SearchParams = Record<string, string | string[] | undefined>;

function toSearchParams(searchParams: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") params.set(key, first);
  }
  return params;
}

/** Same frame as the login page: the consent screen is the next step of signing in. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <div className="w-full max-w-md space-y-8 p-8">
        {/* eslint-disable-next-line @next/next/no-img-element -- same static logo as the login page */}
        <img alt="AutomatizeJá" src="/logo/3.png" className="mx-auto h-10 w-auto" />
        {children}
      </div>
    </div>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = toSearchParams(await searchParams);
  const { parsed, clientName } = await resolveAuthorizeRequest(params, await headers());

  if (!parsed.ok && parsed.kind === "redirect") {
    redirect(buildRedirect(parsed.redirectUri, { error: parsed.error, error_description: parsed.description, state: parsed.state }));
  }
  if (!parsed.ok) {
    return <Shell><div className="space-y-2 text-center"><h1 className="text-2xl font-bold tracking-tight text-zinc-900">Pedido de conexão inválido</h1><p className="text-sm text-zinc-600">{parsed.description}</p></div><Button asChild variant="outline" size="lg" className="w-full border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-100"><Link href="/">Voltar ao backoffice</Link></Button></Shell>;
  }

  const actor = await getCurrentBackofficeActor();
  if (!actor) redirect(loginUrlWithReturn(`/oauth/authorize?${params}`));

  const client = clientName ?? parsed.request.clientId;
  const canWrite = parsed.request.scopes.includes(MCP_SCOPE_WRITE);
  return (
    <Shell>
      <form action={decideAuthorization} className="space-y-6">
        <input name="query" type="hidden" value={params.toString()} />
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Conectar {client} ao backoffice</h1>
          <p className="text-sm text-zinc-600">O {client} vai agir em seu nome, com as mesmas permissões que você tem no backoffice. Dá para desconectar quando quiser no próprio {client}.</p>
        </div>
        <ul className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-900">
          {["Consultar campanhas e resultados", ...(canWrite ? ["Criar e editar rascunhos, enviar templates à Meta e mandar testes", "Agendar envios, sempre depois de mostrar a prévia e você confirmar"] : [])].map(item =>
            <li key={item} className="flex gap-2.5"><ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-zinc-500" />{item}</li>)}
        </ul>
        <div className="flex flex-col gap-2">
          <Button name="decision" type="submit" value="approve" size="lg" className="w-full border border-zinc-900 bg-zinc-900 text-white shadow-sm hover:border-zinc-800 hover:bg-zinc-800 hover:text-white">Autorizar</Button>
          <Button name="decision" type="submit" value="deny" variant="outline" size="lg" className="w-full border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-100">Recusar</Button>
        </div>
        <p className="text-center text-xs text-zinc-500">Conectado como {actor.email}</p>
      </form>
    </Shell>
  );
}
