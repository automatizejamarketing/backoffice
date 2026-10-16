"use client";

import { useMemo, useState } from "react";
import { Bell, Bot, MessageSquare, Pencil, Phone, Send, Users, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/consultant-workspace/metrics";
import { ALERT_OUTCOME_LABEL, type NoteKind, type WorkspaceClientDetail } from "@/lib/consultant-workspace/types";
import { SIMULATED_ACTION_LABEL } from "./actions";
import { useWorkspaceState } from "./use-workspace-state";

type Item = {
  id: string;
  at: string;
  icon: typeof Bell;
  title: string;
  body?: string | null;
  who?: string | null;
  tone?: "human" | "system" | "meta";
};

const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  nota: "Nota",
  contato: "Contato com o cliente",
  reuniao: "Reunião",
  acao: "Ação",
};

const SOURCE_LABEL: Record<string, string> = {
  external_detected: "na Meta",
  frontend_user: "pelo cliente no app",
  backoffice_admin: "pelo backoffice",
};

const CHANGE_LABEL: Record<string, string> = {
  created: "Criou",
  status_transition: "Mudou status de",
  config_change: "Editou",
  archived: "Arquivou",
  deleted: "Excluiu",
};

const LEVEL_LABEL: Record<string, string> = {
  campaign: "campanha",
  adset: "conjunto",
  ad: "anúncio",
};

/**
 * Linha do tempo única do cliente: notas e contatos do consultor, alertas
 * tratados (no banco e no protótipo), ações simuladas e mudanças detectadas
 * na conta de anúncios.
 */
export function ClientTimeline({
  detail,
  showComposer = true,
  includeMetaChanges = true,
  className,
}: {
  detail: WorkspaceClientDetail;
  showComposer?: boolean;
  includeMetaChanges?: boolean;
  className?: string;
}) {
  const { store, apply, isSaving } = useWorkspaceState();
  const [kind, setKind] = useState<NoteKind>("nota");
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<"tudo" | "pessoas" | "conta">("pessoas");
  const userId = detail.client.userId;

  const items = useMemo(() => {
    const list: Item[] = [];
    for (const note of store.notes.filter((entry) => entry.userId === userId)) {
      list.push({
        id: `note-${note.id}`,
        at: note.createdAt,
        icon: note.kind === "contato" ? Phone : note.kind === "reuniao" ? Users : note.kind === "acao" ? Zap : MessageSquare,
        title: NOTE_KIND_LABEL[note.kind],
        body: note.text,
        who: note.author,
        tone: "human",
      });
    }
    for (const action of store.simulatedActions.filter((entry) => entry.userId === userId)) {
      list.push({
        id: `sim-${action.id}`,
        at: action.at,
        icon: Zap,
        title: `${SIMULATED_ACTION_LABEL[action.action]} · ${action.entityName ?? action.entityId}`,
        body: [action.detail, action.note].filter(Boolean).join(" — "),
        who: action.by,
        tone: "human",
      });
    }
    for (const message of (store.sentMessages ?? []).filter((entry) => entry.userId === userId)) {
      const byMat = message.channel === "mat";
      list.push({
        id: `msg-${message.id}`,
        at: message.at,
        icon: byMat ? Bot : Send,
        title: byMat ? "Mat enviou ao cliente" : "Mensagem ao cliente",
        body: message.text.length > 220 ? `${message.text.slice(0, 220)}…` : message.text,
        who: byMat ? `pedido por ${message.by}` : message.by,
        tone: "human",
      });
    }
    const allAlerts = [...detail.alerts, ...detail.recentlyClosedAlerts];
    for (const [insightId, action] of Object.entries(store.alertActions)) {
      const alert = allAlerts.find((entry) => entry.id === insightId);
      if (!alert || action.status === "snoozed") continue;
      list.push({
        id: `alert-local-${insightId}`,
        at: action.at,
        icon: Bell,
        title: `${action.status === "done" ? "Tratou" : "Dispensou"}: ${alert.ruleTitle}${alert.entityName ? ` · ${alert.entityName}` : ""}`,
        body: action.outcome ? ALERT_OUTCOME_LABEL[action.outcome] : null,
        who: action.by,
        tone: "human",
      });
    }
    for (const alert of detail.recentlyClosedAlerts) {
      if (alert.status === "resolved" || !alert.reviewedAt) continue;
      list.push({
        id: `alert-db-${alert.id}`,
        at: alert.reviewedAt,
        icon: Bell,
        title: `${alert.status === "done" ? "Concluiu" : "Dispensou"}: ${alert.ruleTitle}${alert.entityName ? ` · ${alert.entityName}` : ""}`,
        body: alert.reviewNote,
        who: alert.reviewedBy,
        tone: "human",
      });
    }
    if (includeMetaChanges) {
      for (const change of detail.changes) {
        list.push({
          id: `chg-${change.id}`,
          at: change.occurredAt,
          icon: Pencil,
          title: `${CHANGE_LABEL[change.changeKind] ?? change.changeKind} ${LEVEL_LABEL[change.entityLevel] ?? change.entityLevel} ${change.entityName ?? ""} ${SOURCE_LABEL[change.source] ?? ""}`.trim(),
          body: change.note ?? describeFields(change.changedFields),
          who: change.actor,
          tone: change.source === "backoffice_admin" ? "human" : "meta",
        });
      }
    }
    return list.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [store, detail, userId, includeMetaChanges]);

  const visible = items.filter((item) =>
    filter === "tudo" ? true : filter === "pessoas" ? item.tone === "human" : item.tone === "meta",
  );

  async function addNote() {
    if (!text.trim()) return;
    await apply({ op: "addNote", userId, kind, text: text.trim() });
    setText("");
  }

  return (
    <div className={cn("space-y-3", className)}>
      {showComposer ? (
        <div className="space-y-2 rounded-lg border bg-card p-3">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(NOTE_KIND_LABEL) as NoteKind[])
              .filter((value) => value !== "acao")
              .map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setKind(value)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs",
                    kind === value ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
                  )}
                >
                  {NOTE_KIND_LABEL[value]}
                </button>
              ))}
          </div>
          <Textarea
            rows={2}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Registrar nota, contato ou reunião…"
            className="text-sm"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) addNote();
            }}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={addNote} disabled={isSaving || !text.trim()}>
              Registrar
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex gap-1 text-xs">
        {(["tudo", "pessoas", "conta"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              "rounded px-2 py-0.5",
              filter === value ? "bg-muted font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {value === "tudo" ? "Tudo" : value === "pessoas" ? "Pessoas" : "Mudanças na conta"}
          </button>
        ))}
      </div>
      <ol className="space-y-0">
        {visible.length === 0 ? (
          <li className="py-6 text-center text-sm text-muted-foreground">Nada registrado ainda.</li>
        ) : (
          visible.slice(0, 80).map((item) => (
            <li key={item.id} className="flex gap-3 border-l py-2 pl-3">
              <item.icon
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  item.tone === "human" ? "text-primary" : "text-muted-foreground",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">{item.title}</p>
                {item.body ? <p className="mt-0.5 text-xs text-muted-foreground">{item.body}</p> : null}
                {/* "há N min" muda entre o render do servidor e o do navegador. */}
                <p className="mt-0.5 text-[11px] text-muted-foreground/80" suppressHydrationWarning>
                  {formatRelative(item.at)}
                  {item.who ? ` · ${item.who}` : ""}
                </p>
              </div>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}

function describeFields(fields: Record<string, unknown>): string | null {
  const keys = Object.keys(fields ?? {});
  if (keys.length === 0) return null;
  const names: Record<string, string> = {
    daily_budget: "orçamento diário",
    lifetime_budget: "orçamento total",
    configured_status: "status",
    effective_status: "status de veiculação",
    name: "nome",
    targeting: "público",
    bid_strategy: "estratégia de lance",
    creative_id: "criativo",
  };
  return `Campos: ${keys.slice(0, 4).map((key) => names[key] ?? key).join(", ")}`;
}
