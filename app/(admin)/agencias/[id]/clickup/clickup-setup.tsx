"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Mapping = {
  listId: string;
  listName: string;
  clientFieldId: string;
  mediaFieldId: string | null;
  captionFieldId: string;
  publishAtFieldId: string;
  formats: Record<string, "post" | "reels">;
  statuses: { approval: string; scheduled: string; published: string; error: string | null };
  clientOptions: Record<string, string>;
};

type View = {
  configured: boolean;
  connection: null | {
    status: string;
    statusDetail: string | null;
    clickupUserEmail: string | null;
    teamId: string | null;
    teamName: string | null;
    mapping: Mapping | null;
    webhookActive: boolean;
  };
};

type Field = { id: string; name: string; type: string; options: Array<{ id: string; name: string }> };
type Options = {
  teams: Array<{ id: string; name: string }>;
  lists?: Array<{ id: string; name: string; path: string }>;
  taskTypes?: Array<{ id: number; name: string }>;
  statuses?: string[];
  fields?: Field[];
};

const NONE = "__none__";
const TASK_ATTACHMENTS = "__task_attachments__";

function Picker({ id, label, value, onChange, items, placeholder, hint }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: Array<{ value: string; label: string }>;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full"><SelectValue placeholder={placeholder ?? "Escolha"} /></SelectTrigger>
        <SelectContent>
          {items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ClickupSetup({ agency, clients, initial, flash }: {
  agency: { id: string; name: string };
  clients: Array<{ userId: string; label: string }>;
  initial: View;
  flash: { kind: "ok" | "error"; text: string } | null;
}) {
  const router = useRouter();
  const connection = initial.connection;
  const saved = connection?.mapping ?? null;
  const [teamId, setTeamId] = useState(connection?.teamId ?? "");
  const [draft, setDraft] = useState<Mapping>(
    saved ?? { listId: "", listName: "", clientFieldId: "", mediaFieldId: null, captionFieldId: "", publishAtFieldId: "", formats: {}, statuses: { approval: "", scheduled: "", published: "", error: null }, clientOptions: {} },
  );
  const [options, setOptions] = useState<Options | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const base = `/api/agencies/${agency.id}/clickup`;

  useEffect(() => {
    if (flash) (flash.kind === "ok" ? toast.success : toast.error)(flash.text);
  }, [flash]);

  useEffect(() => {
    if (!connection || connection.status !== "active") return;
    const params = new URLSearchParams();
    if (teamId) params.set("teamId", teamId);
    if (teamId && draft.listId) params.set("listId", draft.listId);
    let cancelled = false;
    setLoading(true);
    fetch(`${base}/options?${params}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? "Não foi possível ler o ClickUp.");
        if (!cancelled) setOptions(data);
      })
      .catch((error) => !cancelled && toast.error(error.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [base, connection, teamId, draft.listId]);

  const fields = useMemo(() => options?.fields ?? [], [options]);
  const ofType = (...types: string[]) => fields.filter((f) => types.includes(f.type)).map((f) => ({ value: f.id, label: f.name }));
  const clientField = fields.find((f) => f.id === draft.clientFieldId);
  const statusItems = (options?.statuses ?? []).map((s) => ({ value: s, label: s }));
  const taskTypes = [{ id: 0, name: "Tarefa" }, ...(options?.taskTypes ?? [])];
  const set = (patch: Partial<Mapping>) => setDraft((d) => ({ ...d, ...patch }));

  async function save() {
    setSaving(true);
    try {
      const team = options?.teams.find((t) => t.id === teamId);
      const response = await fetch(base, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, teamId, teamName: team?.name ?? connection?.teamName ?? "" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar.");
      toast.success("Mapeamento salvo. Tarefas que entrarem no status de aprovação viram agendamentos.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Desconectar o ClickUp? Os agendamentos já criados continuam.")) return;
    const response = await fetch(base, { method: "DELETE" });
    if (response.ok) {
      toast.success("ClickUp desconectado.");
      router.refresh();
    } else toast.error("Não foi possível desconectar.");
  }

  const connectHref = `/api/clickup/oauth/start?agencyId=${agency.id}`;

  return (
    <div className="min-w-0 max-w-4xl space-y-6">
      <div>
        <p className="text-sm text-muted-foreground"><Link className="underline-offset-4 hover:underline" href={`/agencias/${agency.id}`}>{agency.name}</Link></p>
        <h1 className="text-2xl font-bold text-foreground">Postagem pelo ClickUp</h1>
        <p className="text-sm text-muted-foreground">
          Tarefa que entra no status de aprovação vira post agendado no Instagram do cliente. O Automatize escreve na tarefa quando agenda, publica ou falha.
        </p>
      </div>

      {!initial.configured ? (
        <p className="rounded-lg border bg-card p-4 text-sm">O app do ClickUp ainda não foi configurado no Automatize (CLICKUP_CLIENT_ID e CLICKUP_CLIENT_SECRET).</p>
      ) : !connection ? (
        <div className="rounded-lg border bg-card p-4">
          <p className="mb-3 text-sm">Conecte com uma conta do ClickUp que veja a Lista de Publicação. De preferência, um usuário só para a integração: os comentários saem no nome dele.</p>
          <Button asChild><a href={connectHref}>Conectar ClickUp</a></Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
            <div className="min-w-0 text-sm">
              <p>Conectado como <span className="font-medium">{connection.clickupUserEmail ?? "usuário do ClickUp"}</span></p>
              <p className="text-muted-foreground">
                {connection.status === "active"
                  ? connection.webhookActive ? `Recebendo tarefas da lista ${saved?.listName ?? ""}` : "Falta mapear a Lista de Publicação."
                  : connection.statusDetail ?? "O acesso foi revogado."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {connection.status === "active" ? <Badge>Ativo</Badge> : <Button asChild size="sm"><a href={connectHref}>Reconectar ClickUp</a></Button>}
              <Button type="button" variant="ghost" size="sm" onClick={disconnect}><Unplug className="size-4" />Desconectar</Button>
            </div>
          </div>

          {connection.status === "active" ? (
            <div className="space-y-6 rounded-lg border bg-card p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Picker id="cu-team" label="Workspace" value={teamId} onChange={(v) => { setTeamId(v); set({ listId: "", listName: "" }); }} items={(options?.teams ?? []).map((t) => ({ value: t.id, label: t.name }))} />
                <Picker
                  id="cu-list"
                  label="Lista de Publicação"
                  value={draft.listId}
                  onChange={(v) => set({ listId: v, listName: options?.lists?.find((l) => l.id === v)?.name ?? "", clientFieldId: "", mediaFieldId: null, captionFieldId: "", publishAtFieldId: "", clientOptions: {} })}
                  items={(options?.lists ?? []).map((l) => ({ value: l.id, label: `${l.path} / ${l.name}` }))}
                  placeholder={teamId ? "Escolha a lista" : "Escolha o workspace antes"}
                />
              </div>
              {loading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Lendo o ClickUp…</p> : null}

              {draft.listId && fields.length ? (
                <>
                  <fieldset className="space-y-3">
                    <legend className="text-sm font-semibold">Campos da tarefa</legend>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Picker id="cu-client" label="Cliente" value={draft.clientFieldId} onChange={(v) => set({ clientFieldId: v, clientOptions: {} })} items={ofType("drop_down")} hint="Campo de lista suspensa com um cliente por opção." />
                      <Picker id="cu-media" label="Arte" value={draft.mediaFieldId ?? TASK_ATTACHMENTS} onChange={(v) => set({ mediaFieldId: v === TASK_ATTACHMENTS ? null : v })} items={[{ value: TASK_ATTACHMENTS, label: "Anexos da tarefa" }, ...ofType("attachment")]} />
                      <Picker id="cu-caption" label="Legenda" value={draft.captionFieldId} onChange={(v) => set({ captionFieldId: v })} items={ofType("text", "short_text")} />
                      <Picker id="cu-when" label="Horário de publicação" value={draft.publishAtFieldId} onChange={(v) => set({ publishAtFieldId: v })} items={ofType("date")} hint="Data com hora. Lida no horário de Brasília." />
                    </div>
                  </fieldset>

                  <fieldset className="space-y-3">
                    <legend className="text-sm font-semibold">Status</legend>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Picker id="cu-approval" label="Aprovação (dispara o agendamento)" value={draft.statuses.approval} onChange={(v) => set({ statuses: { ...draft.statuses, approval: v } })} items={statusItems} />
                      <Picker id="cu-scheduled" label="Agendado" value={draft.statuses.scheduled} onChange={(v) => set({ statuses: { ...draft.statuses, scheduled: v } })} items={statusItems} hint="Tirar a tarefa daqui cancela o agendamento." />
                      <Picker id="cu-published" label="Publicado" value={draft.statuses.published} onChange={(v) => set({ statuses: { ...draft.statuses, published: v } })} items={statusItems} />
                      <Picker id="cu-error" label="Erro (opcional)" value={draft.statuses.error ?? NONE} onChange={(v) => set({ statuses: { ...draft.statuses, error: v === NONE ? null : v } })} items={[{ value: NONE, label: "Sem status de erro: só comentário" }, ...statusItems]} />
                    </div>
                  </fieldset>

                  <fieldset className="space-y-3">
                    <legend className="text-sm font-semibold">Tipos de tarefa</legend>
                    <div className="grid gap-4 md:grid-cols-3">
                      {taskTypes.map((type) => (
                        <Picker
                          key={type.id}
                          id={`cu-type-${type.id}`}
                          label={type.name}
                          value={draft.formats[String(type.id)] ?? NONE}
                          onChange={(v) => {
                            const formats = { ...draft.formats };
                            if (v === NONE) delete formats[String(type.id)];
                            else formats[String(type.id)] = v as "post" | "reels";
                            set({ formats });
                          }}
                          items={[{ value: NONE, label: "Ignorar" }, { value: "post", label: "Post (imagem ou carrossel)" }, { value: "reels", label: "Reels" }]}
                        />
                      ))}
                    </div>
                  </fieldset>

                  {clientField ? (
                    <fieldset className="space-y-3">
                      <legend className="text-sm font-semibold">Clientes</legend>
                      <p className="text-xs text-muted-foreground">Ligue cada opção do campo Cliente a um cliente da agência. Renomear a opção no ClickUp não desfaz a ligação.</p>
                      <div className="grid gap-4 md:grid-cols-2">
                        {clientField.options.map((option) => (
                          <Picker
                            key={option.id}
                            id={`cu-opt-${option.id}`}
                            label={option.name}
                            value={draft.clientOptions[option.id] ?? NONE}
                            onChange={(v) => {
                              const clientOptions = { ...draft.clientOptions };
                              if (v === NONE) delete clientOptions[option.id];
                              else clientOptions[option.id] = v;
                              set({ clientOptions });
                            }}
                            items={[{ value: NONE, label: "Não ligada" }, ...clients.map((c) => ({ value: c.userId, label: c.label }))]}
                          />
                        ))}
                      </div>
                    </fieldset>
                  ) : null}

                  <div className="flex justify-end">
                    <Button type="button" onClick={save} disabled={saving}>
                      {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                      Salvar e ligar a lista
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
