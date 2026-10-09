"use client";

import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatShortDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import {
  CLAUDE_CODE_SERVER_NAME,
  CONNECTOR_NAME,
  TEST_PROMPT,
  claudeCodeCommand,
  claudeConnectorLink,
  type McpCapability,
} from "@/lib/mcp/connections";

export type ConnectionRow = {
  actorEmail: string;
  actorName: string | null;
  clientId: string;
  clientName: string;
  connectedAt: string;
  lastActivityAt: string;
};

const sameConnection = (a: ConnectionRow, b: ConnectionRow) =>
  a.actorEmail === b.actorEmail && a.clientId === b.clientId;

function CopyField({ label, value, wrap = false }: { label: string; value: string; wrap?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie.");
    }
  }
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex min-w-0 items-center gap-1 rounded-md border bg-muted/40 py-1 pr-1 pl-3">
        {wrap ? (
          <p className="min-w-0 flex-1 py-1 text-sm text-foreground">{value}</p>
        ) : (
          <code className="min-w-0 flex-1 truncate font-mono text-sm" title={value}>
            {value}
          </code>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={copy}
          aria-label={`Copiar ${label.toLowerCase()}`}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
      <span
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-full border bg-background text-xs font-semibold tabular-nums"
      >
        {n}
      </span>
      <div className="min-w-0 space-y-2 pt-0.5 pb-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <div className="space-y-3 text-sm text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

function ConnectSteps({ serverUrl }: { serverUrl: string }) {
  return (
    <Tabs defaultValue="claude" className="gap-4">
      <TabsList>
        <TabsTrigger value="claude">Claude (site e app)</TabsTrigger>
        <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
      </TabsList>

      <TabsContent value="claude" className="mt-4">
        <ol className="space-y-5">
          <Step n={1} title="Adicione o conector">
            <p>Abra o formulário do Claude com nome e endereço já preenchidos e clique em Add.</p>
            <Button asChild variant="outline" size="sm">
              <a href={claudeConnectorLink(serverUrl)} target="_blank" rel="noreferrer">
                Abrir no Claude
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
            <p>
              Se o formulário não abrir, vá em Configurações → Conectores → Adicionar conector
              personalizado e preencha:
            </p>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
              <CopyField label="Nome" value={CONNECTOR_NAME} />
              <CopyField label="Endereço" value={serverUrl} />
            </div>
          </Step>
          <Step n={2} title="Autorize com a sua conta do backoffice">
            <p>
              Clique em Connect no conector {CONNECTOR_NAME}. O Claude abre o backoffice: entre com o
              seu e-mail da equipe e clique em Autorizar.
            </p>
          </Step>
          <Step n={3} title="Teste">
            <p>Numa conversa nova, deixe o conector ligado no menu de ferramentas e envie:</p>
            <CopyField label="Mensagem" value={TEST_PROMPT} wrap />
            <p>Se a sua carteira aparecer na resposta, está funcionando.</p>
          </Step>
        </ol>
        <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">
          Usa o Claude de uma empresa (plano Team ou Enterprise)? Quem administra a organização adiciona
          o conector uma vez; depois cada pessoa só clica em Connect.
        </p>
      </TabsContent>

      <TabsContent value="claude-code" className="mt-4">
        <ol className="space-y-5">
          <Step n={1} title="Adicione o servidor">
            <p>No terminal, rode:</p>
            <CopyField label="Comando" value={claudeCodeCommand(serverUrl)} />
          </Step>
          <Step n={2} title="Autorize">
            <p>
              No Claude Code, digite <code className="font-mono text-foreground">/mcp</code>, escolha{" "}
              <code className="font-mono text-foreground">{CLAUDE_CODE_SERVER_NAME}</code> e depois
              Authenticate. O navegador abre o backoffice para você autorizar.
            </p>
          </Step>
          <Step n={3} title="Teste">
            <CopyField label="Mensagem" value={TEST_PROMPT} wrap />
          </Step>
        </ol>
      </TabsContent>
    </Tabs>
  );
}

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
            <TableHead className="hidden md:table-cell">Conectado em</TableHead>
            <TableHead className={showPerson ? "hidden sm:table-cell" : undefined}>Última atividade</TableHead>
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
                    <div className="text-xs text-muted-foreground sm:hidden">{row.clientName}</div>
                  </TableCell>
                ) : null}
                <TableCell className={showPerson ? "hidden font-medium sm:table-cell" : "font-medium"}>{row.clientName}</TableCell>
                <TableCell className="hidden tabular-nums md:table-cell">{formatShortDateTimeInSaoPaulo(row.connectedAt)}</TableCell>
                <TableCell className={showPerson ? "hidden tabular-nums sm:table-cell" : "tabular-nums"}>{formatShortDateTimeInSaoPaulo(row.lastActivityAt)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => onDisconnect(row)}>
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

export function ClaudePageClient({
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
  const [mine, setMine] = useState(ownConnections);
  const [team, setTeam] = useState(teamConnections);
  const [target, setTarget] = useState<{ row: ConnectionRow; own: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

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
      setMine((rows) => rows.filter((r) => !sameConnection(r, row)));
      setTeam((rows) => rows?.filter((r) => !sameConnection(r, row)) ?? null);
      toast.success(`${row.clientName} desconectado.`);
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
        <h1 className="text-2xl font-bold text-foreground">Claude</h1>
        <p className="text-sm text-muted-foreground">
          Converse com o Claude sobre a sua carteira. Ele consulta o backoffice com as suas permissões.
        </p>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="connect-title" className="min-w-0 rounded-lg border bg-card p-5">
          <h2 id="connect-title" className="mb-4 text-base font-semibold">
            Conectar
          </h2>
          <ConnectSteps serverUrl={serverUrl} />
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
            Desconectar corta o acesso na hora. Para voltar, conecte de novo pelo Claude.
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
            <AlertDialogTitle>Desconectar o {target?.row.clientName}?</AlertDialogTitle>
            <AlertDialogDescription>
              {target?.own
                ? `O ${target.row.clientName} perde o acesso ao backoffice na hora. Para voltar a usar, conecte de novo pelo Claude.`
                : `O ${target?.row.clientName} de ${target?.row.actorName ?? target?.row.actorEmail} perde o acesso ao backoffice na hora. A pessoa precisa conectar de novo para voltar a usar.`}
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
