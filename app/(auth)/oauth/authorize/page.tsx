import { Check, TriangleAlert } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AiProviderMark } from "@/components/ai-provider-logo";
import { Button } from "@/components/ui/button";
import { loginUrlWithReturn } from "@/lib/auth/login-return";
import { getCurrentBackofficeActor } from "@/lib/auth/rbac";
import { consentItems, identifyClient, type ClientIdentity } from "@/lib/mcp/connections";
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

/**
 * The consent screen is the next step of signing in, so it keeps the login's
 * light frame; the band on top shows who is connecting to what.
 */
function Shell({ client, children }: { client: ClientIdentity | null; children: React.ReactNode }) {
  const label = client?.label ?? null;
  return (
    <div className="flex min-h-screen items-start justify-center bg-zinc-50 px-3 py-6 sm:items-center sm:py-12">
      <main className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_24px_60px_-28px_rgba(46,42,138,0.35)]">
        <div
          role="img"
          aria-label={label ? `AutomatizeJá com ${label}` : "AutomatizeJá"}
          className="grid place-items-center gap-3 bg-[radial-gradient(circle_at_85%_0%,rgba(217,119,87,0.35),transparent_45%),linear-gradient(135deg,#5F55D2_0%,#3A33A3_60%,#2B2780_100%)] px-6 py-8"
        >
          <div className="flex items-center gap-3">
            <span className="grid size-14 place-items-center rounded-2xl bg-white shadow-lg ring-1 ring-white/30">
              {/* eslint-disable-next-line @next/next/no-img-element -- same static mark as the sidebar */}
              <img alt="" src="/logo/1.png" className="size-7 object-contain" />
            </span>
            {client ? (
              <>
                <span aria-hidden="true" className="relative h-px w-8 bg-white/70">
                  <span className="absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_5px_rgba(255,255,255,0.15)] motion-safe:animate-pulse" />
                </span>
                <AiProviderMark provider={client.provider} terminal={client.local} className="size-14 rounded-2xl border-0 shadow-lg ring-1 ring-white/30" />
              </>
            ) : null}
          </div>
          <p className="text-center text-sm font-semibold [overflow-wrap:anywhere] text-white">
            Backoffice{label ? <span className="font-normal text-white/75"> com </span> : null}
            {label}
          </p>
        </div>
        <div className="space-y-5 p-6 sm:p-7">{children}</div>
      </main>
    </div>
  );
}

function Eyebrow({ children, caution = false }: { children: React.ReactNode; caution?: boolean }) {
  return (
    <p className={`flex items-center gap-2 text-xs font-semibold tracking-wide uppercase ${caution ? "text-amber-700" : "text-[#5F55D2]"}`}>
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${caution ? "bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.15)]" : "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]"}`}
      />
      {children}
    </p>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = toSearchParams(await searchParams);
  const { parsed, clientName } = await resolveAuthorizeRequest(params, await headers());

  if (!parsed.ok && parsed.kind === "redirect") {
    redirect(buildRedirect(parsed.redirectUri, { error: parsed.error, error_description: parsed.description, state: parsed.state }));
  }
  if (!parsed.ok) {
    return (
      <Shell client={null}>
        <div className="space-y-2">
          <Eyebrow>Conexão interrompida</Eyebrow>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Pedido de conexão inválido</h1>
          <p className="text-sm text-zinc-600">{parsed.description}</p>
          <p className="text-sm text-zinc-600">Volte ao app e tente conectar de novo.</p>
        </div>
        <Button asChild variant="outline" size="lg" className="w-full border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-100">
          <Link href="/">Voltar ao backoffice</Link>
        </Button>
      </Shell>
    );
  }

  const actor = await getCurrentBackofficeActor();
  if (!actor) redirect(loginUrlWithReturn(`/oauth/authorize?${params}`));

  // Branded by where the code goes, not by the self-registered name.
  const identity = identifyClient(clientName ?? parsed.request.clientId, [parsed.request.redirectUri]);
  const client = identity.label;
  const items = consentItems(actor, parsed.request.scopes.includes(MCP_SCOPE_WRITE));
  const redirectHost = new URL(parsed.request.redirectUri).host;

  return (
    <Shell client={identity}>
      <form action={decideAuthorization} className="space-y-5">
        <input name="query" type="hidden" value={params.toString()} />
        <div className="space-y-2">
          {/* Only a redirect to Claude's or ChatGPT's own domain proves who is asking. */}
          {identity.provider ? <Eyebrow>Conexão segura</Eyebrow> : <Eyebrow caution>Confira o app antes de autorizar</Eyebrow>}
          <h1 className="text-2xl font-bold tracking-tight [overflow-wrap:anywhere] text-zinc-900">Conectar {client} ao backoffice?</h1>
          <p className="text-sm text-zinc-600">
            Entrou como <span className="font-medium text-zinc-900">{actor.email}</span> · retorno para{" "}
            <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-xs whitespace-nowrap text-zinc-700">{redirectHost}</span>
          </p>
        </div>

        {identity.local ? (
          <p className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            Este app roda no seu computador. Autorize só se foi você quem iniciou a conexão agora.
          </p>
        ) : null}

        {items.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-900">O {client} vai agir em seu nome e poderá:</p>
            <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
              {items.map((item) => (
                <li key={item} className="flex gap-2.5 px-3.5 py-3 text-sm text-zinc-800">
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
            O seu cargo no backoffice não usa o conector de IA. Se precisar, peça acesso a quem gerencia a equipe.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {items.length > 0 ? (
            <Button name="decision" type="submit" value="approve" size="lg" className="w-full border border-zinc-900 bg-zinc-900 text-white shadow-sm hover:border-zinc-800 hover:bg-zinc-800 hover:text-white">
              Autorizar conexão
            </Button>
          ) : null}
          <Button name="decision" type="submit" value="deny" variant="outline" size="lg" className="w-full border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-100">
            Cancelar
          </Button>
        </div>
        <p className="text-center text-xs text-zinc-500">
          Você pode desconectar quando quiser em Conectar IA, no backoffice, ou no próprio {client}.
        </p>
      </form>
    </Shell>
  );
}
