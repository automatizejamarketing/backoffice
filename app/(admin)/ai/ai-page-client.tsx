"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AiProviderMark } from "@/components/ai-provider-logo";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatShortDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { connectionKey, identifyClient, visibleConnections, type McpCapability } from "@/lib/mcp/connections";
import { ConnectGuide } from "./connect-guide";

export type ConnectionRow = {
  actorEmail: string;
  actorName: string | null;
  clientId: string;
  clientName: string;
  redirectUris: string[];
  firstConnectedAt: string;
  lastActivityAt: string;
};

const identity = (row: ConnectionRow) => identifyClient(row.clientName, row.redirectUris);
const appName = (row: ConnectionRow) => identity(row).label;


function ConnectionsTable({
  rows,
  showPerson,
  empty,
  onDisconnect,
}: {
  rows: ConnectionRow[];
  showPerson: boolean;
  empty: string;
  onDisconnect: (row: ConnectionRow) => void;
}) {
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {showPerson ? <TableHead>Pessoa</TableHead> : null}
            <TableHead className={showPerson ? "hidden sm:table-cell" : undefined}>App</TableHead>
            <TableHead className="hidden md:table-cell">Primeira conexão</TableHead>
            <TableHead className="hidden sm:table-cell">Última atividade</TableHead>
            <TableHead className="w-0">
              <span className="sr-only">Ações</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={showPerson ? 5 : 4} className="py-8 text-center text-sm text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={`${row.actorEmail}:${row.clientId}`}>
                {showPerson ? (
                  <TableCell className="whitespace-normal">
                    <div className="font-medium break-all">{row.actorName ?? row.actorEmail}</div>
                    {row.actorName ? <div className="text-xs break-all text-muted-foreground">{row.actorEmail}</div> : null}
                    <div className="text-xs text-muted-foreground sm:hidden">
                      {appName(row)} · {formatShortDateTimeInSaoPaulo(row.lastActivityAt)}
                    </div>
                  </TableCell>
                ) : null}
                <TableCell className={showPerson ? "hidden sm:table-cell" : undefined}>
                  <span className="flex items-center gap-2.5 font-medium">
                    <AiProviderMark provider={identity(row).provider} terminal={identity(row).local} className="size-7" />
                    <span className="break-all">
                      {appName(row)}
                      <span className="block text-xs font-normal text-muted-foreground tabular-nums sm:hidden">
                        Última atividade: {formatShortDateTimeInSaoPaulo(row.lastActivityAt)}
                      </span>
                    </span>
                  </span>
                </TableCell>
                <TableCell className="hidden tabular-nums md:table-cell">{formatShortDateTimeInSaoPaulo(row.firstConnectedAt)}</TableCell>
                <TableCell className="hidden tabular-nums sm:table-cell">{formatShortDateTimeInSaoPaulo(row.lastActivityAt)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onDisconnect(row)}
                    aria-label={showPerson ? `Desconectar ${appName(row)} de ${row.actorName ?? row.actorEmail}` : `Desconectar ${appName(row)}`}
                  >
                    Desconectar
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function AiPageClient({
  serverUrl,
  capabilities,
  ownConnections,
  teamConnections,
}: {
  serverUrl: string;
  capabilities: McpCapability[];
  ownConnections: ConnectionRow[];
  teamConnections: ConnectionRow[] | null;
}) {
  // The lists come from the server (router.refresh brings new ones); a
  // disconnect only hides that row here until the server stops sending it.
  const [hidden, setHidden] = useState<Record<string, string>>({});
  const mine = visibleConnections(ownConnections, hidden);
  const team = teamConnections ? visibleConnections(teamConnections, hidden) : null;
  const [target, setTarget] = useState<{ row: ConnectionRow; own: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  function showConnections() {
    router.refresh();
    document.getElementById("mine-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function disconnect() {
    if (!target) return;
    const { row } = target;
    setBusy(true);
    try {
      const response = await fetch("/api/backoffice/mcp-connections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail: row.actorEmail, clientId: row.clientId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Não foi possível desconectar.");
      }
      const { revoked } = (await response.json()) as { revoked: number };
      setHidden((current) => ({ ...current, [connectionKey(row)]: row.lastActivityAt }));
      router.refresh();
      if (revoked > 0) toast.success(`${appName(row)} desconectado.`);
      else toast.info(`${appName(row)} já estava desconectado.`);
      setTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível desconectar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Conectar IA</h1>
        <p className="text-sm text-muted-foreground">
          Converse com o Claude ou o ChatGPT sobre a sua carteira. A IA consulta o backoffice com as suas permissões.
        </p>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="connect-title" className="min-w-0 rounded-lg border bg-card p-5">
          <h2 id="connect-title" className="mb-4 text-base font-semibold">
            Conectar
          </h2>
          <ConnectGuide serverUrl={serverUrl} onDone={showConnections} />
        </section>

        <section aria-labelledby="ask-title" className="min-w-0 space-y-5 rounded-lg border bg-card p-5">
          <h2 id="ask-title" className="text-base font-semibold">
            O que perguntar
          </h2>
          {capabilities.map((capability) => (
            <div key={capability.permission} className="space-y-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {capability.title}
              </p>
              <ul className="space-y-2">
                {capability.examples.map((example) => (
                  <li key={example} className="border-l-2 pl-3 text-sm text-foreground">
                    {example}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{capability.limit}</p>
            </div>
          ))}
        </section>
      </div>

      <section aria-labelledby="mine-title" className="space-y-3">
        <div>
          <h2 id="mine-title" className="text-base font-semibold">
            Suas conexões
          </h2>
          <p className="text-sm text-muted-foreground">
            Desconectar corta o acesso na hora. Para voltar, conecte de novo pelo app.
          </p>
        </div>
        <ConnectionsTable
          rows={mine}
          showPerson={false}
          empty="Você ainda não conectou nenhum app. Siga os passos acima."
          onDisconnect={(row) => setTarget({ row, own: true })}
        />
      </section>

      {team ? (
        <section aria-labelledby="team-title" className="space-y-3">
          <div>
            <h2 id="team-title" className="text-base font-semibold">
              Conexões da equipe
            </h2>
            <p className="text-sm text-muted-foreground">
              Todos os apps conectados ao backoffice, de todas as pessoas.
            </p>
          </div>
          <ConnectionsTable
            rows={team}
            showPerson
            empty="Ninguém da equipe conectou um app ainda."
            onDisconnect={(row) => setTarget({ row, own: false })}
          />
        </section>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Última atividade é quando o app pegou ou renovou o acesso. Ele renova ao usar, no máximo uma vez
        por hora.
      </p>

      <AlertDialog open={target !== null} onOpenChange={(open) => (!open && !busy ? setTarget(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar o {target ? appName(target.row) : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              {target?.own
                ? `O ${appName(target.row)} perde o acesso ao backoffice na hora. Para voltar a usar, conecte de novo pelo app.`
                : `O ${target ? appName(target.row) : ""} de ${target?.row.actorName ?? target?.row.actorEmail} perde o acesso ao backoffice na hora. A pessoa precisa conectar de novo para voltar a usar.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void disconnect();
              }}
              disabled={busy}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
