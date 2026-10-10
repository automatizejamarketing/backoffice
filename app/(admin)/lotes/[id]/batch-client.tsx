"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { cn } from "@/lib/utils";

type Item = {
  n: number;
  client: string;
  level: "campaign" | "adset" | "ad";
  id: string;
  name: string | null;
  action: "pause" | "activate" | "set_daily_budget";
  from?: string | number | null;
  to?: string | number | null;
  currency?: string | null;
  skipped?: string;
  warning?: string;
  outcome?: "applied" | "already_applied" | "changed_since_preview" | "failed";
  error?: string;
  auditPending?: boolean;
};

export type BatchView = {
  batchId: string;
  status: "previewed" | "running" | "partial" | "done";
  note: string;
  expiresAt?: string;
  summary: { toRun: number; skipped: number; applied: number; failed: number; pending: number; changedSincePreview: number; alreadyApplied: number };
  items: Item[];
  notes?: string[];
};

const LEVEL: Record<Item["level"], string> = { campaign: "Campanha", adset: "Conjunto", ad: "Anúncio" };
const ACTION: Record<Item["action"], string> = { pause: "Pausar", activate: "Ativar", set_daily_budget: "Orçamento diário" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Ativo", PAUSED: "Pausado" };

const OUTCOME: Record<NonNullable<Item["outcome"]>, { tone: StatusTone; label: string }> = {
  applied: { tone: "success", label: "Aplicado" },
  already_applied: { tone: "neutral", label: "Já estava assim" },
  changed_since_preview: { tone: "warning", label: "Mudou depois da prévia" },
  failed: { tone: "danger", label: "Falhou" },
};

function value(item: Item, v: string | number | null | undefined) {
  if (v == null) return "—";
  if (item.action !== "set_daily_budget") return STATUS_LABEL[String(v)] ?? String(v);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: item.currency ?? "BRL" }).format(Number(v));
}

/** O que o botão vai fazer, contado: "pausar 8, ativar 2 e mudar o orçamento de 4". */
function plannedSentence(items: Item[]) {
  const run = items.filter(i => !i.skipped);
  const count = (a: Item["action"]) => run.filter(i => i.action === a).length;
  const parts = [
    count("pause") && `pausar ${count("pause")}`,
    count("activate") && `ativar ${count("activate")}`,
    count("set_daily_budget") && `mudar o orçamento de ${count("set_daily_budget")}`,
  ].filter(Boolean) as string[];
  const clients = new Set(run.map(i => i.client)).size;
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}` : parts[0];
  return `Vai ${list} em ${clients} ${clients === 1 ? "cliente" : "clientes"}.`;
}

export function BatchClient({ initial, isOwner, initialMode }: { initial: BatchView; isOwner: boolean; initialMode: "approve" | "resume" | null }) {
  const router = useRouter();
  const [batch, setBatch] = useState(initial);
  const [mode, setMode] = useState(initialMode);
  const [running, setRunning] = useState(false);
  const canRun = isOwner && mode != null;
  const byClient = useMemo(() => {
    const groups = new Map<string, Item[]>();
    for (const item of batch.items) groups.set(item.client, [...(groups.get(item.client) ?? []), item]);
    return [...groups];
  }, [batch.items]);

  async function run() {
    setRunning(true);
    try {
      const response = await fetch(`/api/meta-batches/${batch.batchId}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(data.error ?? "Não foi possível executar o lote.");
        router.refresh();
        return;
      }
      setBatch(data);
      setMode(data.status === "partial" ? "resume" : null);
      toast.success(data.status === "done" ? "Lote executado." : "Parte do lote foi executada. Use Continuar para o resto.");
    } catch {
      toast.error("A conexão caiu durante a execução. Atualize a página para ver o que já rodou.");
    } finally {
      setRunning(false);
    }
  }

  const statusLine =
    batch.status === "previewed"
      ? mode ? `Esperando sua aprovação · vale até ${formatTimeInSaoPaulo(batch.expiresAt!)}` : "A prévia venceu. Peça uma nova à IA."
      : batch.status === "running" ? (mode ? "A execução parou no meio · dá para continuar" : "Em execução")
      : batch.status === "partial" ? (mode ? `Parcial · ${batch.summary.pending} pendente(s)` : "Parcial · passou de 1 hora; peça uma nova prévia à IA")
      : "Executado";

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground text-sm">Lote de ações na Meta Ads · preparado pela IA</p>
          <h1 className="text-2xl font-semibold">{batch.note}</h1>
          <p className="text-muted-foreground text-sm">{statusLine}</p>
        </div>
        {canRun ? (
          <div className="flex flex-col items-start gap-2 md:items-end">
            <p className="text-sm">{mode === "approve" ? plannedSentence(batch.items) : "Continua de onde parou, relendo cada item antes de escrever."}</p>
            <Button disabled={running} onClick={run} size="lg">
              {running ? <Loader2 className="size-4 animate-spin" /> : null}
              {running ? "Executando…" : mode === "approve" ? "Aprovar e executar" : "Continuar"}
            </Button>
          </div>
        ) : !isOwner && batch.status !== "done" ? (
          <p className="text-muted-foreground text-sm">Só quem pediu este lote pode aprová-lo.</p>
        ) : null}
      </header>

      {batch.status !== "previewed" ? (
        <p className="text-sm tabular-nums">
          {batch.summary.applied} aplicado(s) · {batch.summary.alreadyApplied} já estavam assim · {batch.summary.changedSincePreview} mudaram depois da prévia · {batch.summary.failed} com falha
          {batch.summary.pending ? ` · ${batch.summary.pending} pendente(s)` : ""}
        </p>
      ) : null}
      {batch.notes?.map(note => <p className="text-sm text-warning" key={note}>{note}</p>)}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Objeto</TableHead>
            <TableHead>Ação</TableHead>
            <TableHead>Antes → depois</TableHead>
            <TableHead>Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {byClient.map(([client, items]) => (
            <ClientRows client={client} items={items} key={client} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ClientRows({ client, items }: { client: string; items: Item[] }) {
  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell className="font-medium" colSpan={4}>{client}</TableCell>
      </TableRow>
      {items.map(item => (
        <TableRow className={cn(item.skipped && "text-muted-foreground")} key={item.n}>
          <TableCell className="max-w-80">
            <p className="truncate">{item.name ?? item.id}</p>
            <p className="text-muted-foreground text-xs">{LEVEL[item.level]} · {item.id}</p>
          </TableCell>
          <TableCell>{ACTION[item.action]}</TableCell>
          <TableCell className="whitespace-nowrap tabular-nums">
            {item.skipped ? "—" : (
              <span className="inline-flex items-center gap-1.5">
                {value(item, item.from)} <ArrowRight aria-label="para" className="size-3.5 text-muted-foreground" /> {value(item, item.to)}
              </span>
            )}
          </TableCell>
          <TableCell className="max-w-96">
            {item.outcome ? (
              <StatusBadge tone={OUTCOME[item.outcome].tone}>{OUTCOME[item.outcome].label}</StatusBadge>
            ) : item.skipped ? null : (
              <span className="text-muted-foreground text-sm">Na fila</span>
            )}
            {item.skipped ? <p className="text-sm">Fica de fora: {item.skipped}</p> : null}
            {item.warning && !item.outcome ? <p className="text-sm text-warning">{item.warning}</p> : null}
            {item.error ? <p className="mt-1 text-sm text-destructive">{item.error}</p> : null}
            {item.auditPending ? <p className="mt-1 text-xs text-muted-foreground">Histórico ainda não registrado; Continuar tenta de novo.</p> : null}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
