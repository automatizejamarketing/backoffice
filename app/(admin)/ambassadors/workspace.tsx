"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { AMBASSADOR_HELP } from "@/lib/ambassadors/help";
import {
  AUTOMATIC_DUE_KEYS,
  COPRODUCTION_KEYS,
  MATERIAL_KEYS,
  MONTHLY_KEYS,
  PUBLICITY_KEYS,
  TASK_LABELS,
  getTasks,
  isDone,
  missingDependencies,
  todayInBrazil,
  type AmbassadorWorkflow,
  type TaskChange,
  type TaskKey,
} from "@/lib/ambassadors/workflow";
import type {
  ambassadorOptions,
  listAmbassadors,
  ambassadorHistory,
} from "@/lib/ambassadors/queries";

type Row = Awaited<ReturnType<typeof listAmbassadors>>[number];
type Options = Awaited<ReturnType<typeof ambassadorOptions>>;
type Data = Options & { rows: Row[] };
type History = Awaited<ReturnType<typeof ambassadorHistory>>;
async function request<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar.");
  return data;
}
const dateLabel = (date: string | null | undefined) =>
  date ? date.split("-").reverse().join("/") : "Sem data";
function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="grid gap-1.5 text-sm font-medium">
      <label htmlFor={id}>{label}</label>
      {Children.map(children, (child, index) =>
        index === 0 && isValidElement(child)
          ? cloneElement(child as ReactElement<{ id?: string }>, { id })
          : child,
      )}
    </div>
  );
}
const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AmbassadorWorkspace({
  canGrant,
  isAdmin,
}: {
  canGrant: boolean;
  isAdmin: boolean;
}) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["ambassadors"],
    queryFn: () => request<Data>("/api/ambassadors"),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<"help" | "add" | "team" | null>(null);
  const [owner, setOwner] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("active");
  const [busy, setBusy] = useState(false);
  async function save(url: string, method: string, data: unknown) {
    setBusy(true);
    try {
      await request(url, method, data);
      await client.invalidateQueries({ queryKey: ["ambassadors"] });
      await client.invalidateQueries({ queryKey: ["ambassador-history"] });
      toast.success("Alteração salva");
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível salvar.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  const data = query.data;
  const row = data?.rows.find((item) => item.record.id === selected);
  const rows =
    data?.rows.filter(
      (item) =>
        (!owner ||
          [
            item.record.publicityOwnerId,
            item.record.coproductionOwnerId,
          ].includes(owner)) &&
        (!category || item.record.category === category) &&
        (!status || item.record.active === (status === "active")) &&
        `${item.name} ${item.email}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    ) ?? [];
  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Embaixadores
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Parcerias, publicações e coprodução em um só lugar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setModal("help")}>
            Como funciona
          </Button>
          {isAdmin && (
            <Button variant="outline" onClick={() => setModal("team")}>
              Acessos da equipe
            </Button>
          )}
          <Button onClick={() => setModal("add")} disabled={!data}>
            Adicionar embaixador
          </Button>
        </div>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Buscar">
          <Input
            placeholder="Nome ou e-mail"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <Field label="Responsável">
          <select
            className={selectClass}
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="">Todos</option>
            {data?.team.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name || member.email}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Categoria">
          <select
            className={selectClass}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Todas</option>
            <option value="ambassador">Embaixador</option>
            <option value="coproducer">Embaixador Coprodutor</option>
          </select>
        </Field>
        <Field label="Parceria">
          <select
            className={selectClass}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="active">Ativas</option>
            <option value="ended">Encerradas</option>
            <option value="">Todas</option>
          </select>
        </Field>
      </div>
      {query.isPending ? (
        <p role="status" className="p-8 text-muted-foreground">
          Carregando embaixadores…
        </p>
      ) : query.isError ? (
        <div role="alert">
          Não foi possível carregar.{" "}
          <Button variant="outline" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <h2 className="font-medium">Nenhum embaixador encontrado</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Adicione um afiliado ou ajuste os filtros.
          </p>
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {rows.map((item) => {
            const pending = pendingTasks(
              item.record.workflow,
              item.record.category,
            );
            const overdue = pending.filter(
              (task) => task.due && task.due < todayInBrazil(),
            );
            const next = pending.find((task) => task.due);
            return (
              <button
                key={item.record.id}
                className="flex w-full flex-col gap-3 p-5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between"
                onClick={() => setSelected(item.record.id)}
              >
                <div>
                  <div className="font-medium">{item.name || item.email}</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {item.record.category === "coproducer"
                      ? "Embaixador Coprodutor"
                      : "Embaixador"}{" "}
                    ·{" "}
                    {data?.team.find(
                      (m) => m.id === item.record.publicityOwnerId,
                    )?.name ?? "Responsável indisponível"}
                  </div>
                </div>
                <div className="text-sm sm:text-right">
                  {!item.record.active ? (
                    <span className="text-muted-foreground">
                      Parceria encerrada
                    </span>
                  ) : overdue.length ? (
                    <span className="text-destructive">
                      {overdue.length} tarefa(s) atrasada(s)
                    </span>
                  ) : (
                    <span>
                      {next
                        ? `${next.label} · ${dateLabel(next.due)}`
                        : "Aguardando próximas etapas"}
                    </span>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.benefit
                      ? `Starter até ${dateLabel(item.benefit.expiresOn)}`
                      : "Starter ainda não liberado"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => !open && setModal(null)}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {modal === "help"
                ? "Como funciona"
                : modal === "team"
                  ? "Acessos da equipe"
                  : "Adicionar embaixador"}
            </DialogTitle>
            <DialogDescription>
              {modal === "help"
                ? "Regras do acompanhamento e da gratuidade."
                : modal === "team"
                  ? "Administradores já têm acesso. Autorize Bernardo e os integrantes que acompanharão as parcerias."
                  : "Selecione um afiliado existente e os responsáveis."}
            </DialogDescription>
          </DialogHeader>
          {modal === "help" ? (
            <div className="space-y-6">
              {AMBASSADOR_HELP.map((section) => (
                <section key={section.title}>
                  <h3 className="mb-2 font-semibold">{section.title}</h3>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    {section.body}
                  </p>
                </section>
              ))}
            </div>
          ) : modal === "team" && data ? (
            <div className="space-y-3">
              {data.team.map((member) => (
                <div key={member.id} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">
                    {member.name || member.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {member.email}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={
                          member.role === "admin" || Boolean(member.member)
                        }
                        disabled={busy || member.role === "admin"}
                        onChange={(e) =>
                          void save("/api/ambassadors/members", "PUT", {
                            userId: member.id,
                            enabled: e.target.checked,
                            canGrantStarter: false,
                          })
                        }
                      />{" "}
                      Acesso à aba
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={
                          member.role === "admin" ||
                          Boolean(member.canGrantStarter)
                        }
                        disabled={
                          busy || member.role === "admin" || !member.member
                        }
                        onChange={(e) =>
                          void save("/api/ambassadors/members", "PUT", {
                            userId: member.id,
                            enabled: true,
                            canGrantStarter: e.target.checked,
                          })
                        }
                      />{" "}
                      Liberar Starter (Bernardo)
                    </label>
                  </div>
                </div>
              ))}
            </div>
          ) : modal === "add" && data ? (
            <DetailsForm
              team={data.team}
              affiliates={data.affiliates}
              busy={busy}
              onSave={async (values) => {
                if (await save("/api/ambassadors", "POST", values))
                  setModal(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Sheet
        open={Boolean(row)}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          {row && data && (
            <AmbassadorDetail
              key={row.record.id}
              row={row}
              team={data.team}
              canGrant={canGrant}
              busy={busy}
              save={save}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function pendingTasks(workflow: AmbassadorWorkflow, category: string) {
  return [
    "initial",
    ...Object.keys(workflow.months),
    ...(category === "coproducer" ? ["coproduction"] : []),
  ]
    .flatMap((cycle) =>
      Object.entries(getTasks(workflow, cycle) ?? {})
        .filter(
          ([key, task]) =>
            !isDone(task) &&
            !missingDependencies(workflow, { cycle, key: key as TaskKey })
              .length,
        )
        .map(([key, task]) => ({
          label: TASK_LABELS[key as TaskKey],
          due: task!.dueOn,
        })),
    )
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
}
type Save = (url: string, method: string, data: unknown) => Promise<boolean>;
function DetailsForm({
  team,
  affiliates,
  row,
  busy,
  onSave,
}: {
  team: Options["team"];
  affiliates?: Options["affiliates"];
  row?: Row;
  busy: boolean;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [category, setCategory] = useState(
    row?.record.category ?? "ambassador",
  );
  const owners = team.filter((m) => m.member || m.role === "admin");
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void onSave({
          ...(affiliates ? { affiliateId: form.get("affiliateId") } : {}),
          category,
          publicityOwnerId: form.get("publicityOwnerId"),
          coproductionOwnerId: form.get("coproductionOwnerId") || null,
        });
      }}
    >
      {affiliates && (
        <Field label="Afiliado">
          <select
            name="affiliateId"
            required
            className={selectClass}
            defaultValue=""
          >
            <option value="" disabled>
              Selecione o afiliado
            </option>
            {affiliates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.email} · {a.email}
              </option>
            ))}
          </select>
          {!affiliates.length && (
            <span className="text-muted-foreground">
              Todos os afiliados já foram adicionados.
            </span>
          )}
        </Field>
      )}
      <Field label="Categoria">
        <select
          className={selectClass}
          value={category}
          onChange={(e) =>
            setCategory(e.target.value as "ambassador" | "coproducer")
          }
        >
          <option value="ambassador">Embaixador</option>
          <option value="coproducer">Embaixador Coprodutor</option>
        </select>
      </Field>
      <Field label="Responsável pela publicidade">
        <select
          name="publicityOwnerId"
          className={selectClass}
          required
          defaultValue={row?.record.publicityOwnerId ?? ""}
        >
          <option value="" disabled>
            Selecione
          </option>
          {owners.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name || m.email}
            </option>
          ))}
        </select>
      </Field>
      {category === "coproducer" && (
        <Field label="Responsável pela coprodução">
          <select
            name="coproductionOwnerId"
            className={selectClass}
            required
            defaultValue={row?.record.coproductionOwnerId ?? ""}
          >
            <option value="" disabled>
              Selecione
            </option>
            {owners.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.email}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Button
        type="submit"
        disabled={busy || (affiliates && !affiliates.length)}
      >
        {busy ? "Salvando…" : "Salvar"}
      </Button>
    </form>
  );
}

function AmbassadorDetail({
  row,
  team,
  canGrant,
  busy,
  save,
}: {
  row: Row;
  team: Options["team"];
  canGrant: boolean;
  busy: boolean;
  save: Save;
}) {
  const record = row.record;
  const [edit, setEdit] = useState(false);
  const [grant, setGrant] = useState(false);
  const [ending, setEnding] = useState(false);
  const [note, setNote] = useState("");
  const history = useQuery({
    queryKey: ["ambassador-history", record.id],
    queryFn: () => request<History>(`/api/ambassadors/${record.id}`),
  });
  const mutate = (body: unknown) =>
    save(`/api/ambassadors/${record.id}`, "PATCH", body);
  const changeTask = (change: TaskChange) =>
    mutate({ action: "task", version: record.version, change });
  return (
    <div className="space-y-6 p-5 sm:p-6">
      <SheetHeader className="p-0">
        <SheetTitle>{row.name || row.email}</SheetTitle>
        <SheetDescription>
          {row.email} ·{" "}
          {record.category === "coproducer"
            ? "Embaixador Coprodutor"
            : "Embaixador"}
          {!record.active && " · Parceria encerrada"}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>
          Publicidade:{" "}
          {team.find((member) => member.id === record.publicityOwnerId)?.name ??
            "Responsável indisponível"}
        </p>
        {record.category === "coproducer" && (
          <p>
            Coprodução:{" "}
            {team.find((member) => member.id === record.coproductionOwnerId)
              ?.name ?? "Responsável indisponível"}
          </p>
        )}
      </div>
      <section className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-medium">Benefício Starter</h3>
            <p className="text-sm text-muted-foreground">
              {row.benefit
                ? `Vencimento: ${dateLabel(row.benefit.expiresOn)} · Próximo ciclo: ${dateLabel(row.benefit.nextCreditOn)}`
                : "Nenhuma liberação registrada"}
            </p>
          </div>
          {canGrant && record.active && (
            <Button
              variant="outline"
              disabled={row.paid || busy}
              onClick={() => setGrant(!grant)}
            >
              {row.benefit ? "Prorrogar Starter" : "Liberar Starter"}
            </Button>
          )}
        </div>
        {row.paid && (
          <p className="mt-2 text-sm text-muted-foreground">
            Assinatura ativa: um administrador precisa revisá-la antes de
            liberar a gratuidade.
          </p>
        )}
        {grant && (
          <form
            className="mt-4 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const expiresOn = new FormData(e.currentTarget).get("expiresOn");
              if (
                await save(`/api/ambassadors/${record.id}/starter`, "POST", {
                  expiresOn,
                })
              )
                setGrant(false);
            }}
          >
            <Field label="Vencimento escolhido para o benefício">
              <Input
                type="date"
                name="expiresOn"
                min={
                  row.benefit?.expiresOn &&
                  row.benefit.expiresOn > todayInBrazil()
                    ? row.benefit.expiresOn
                    : todayInBrazil()
                }
                required
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              {row.benefit
                ? "Prorrogar não concede créditos extras nem reinicia o calendário."
                : "Inclui 250 créditos agora e no mesmo dia dos meses seguintes enquanto estiver válido."}
            </p>
            <Button disabled={busy} type="submit">
              Confirmar liberação
            </Button>
          </form>
        )}
      </section>
      {record.active && (
        <div>
          <Button variant="outline" size="sm" onClick={() => setEdit(!edit)}>
            Categoria e responsáveis
          </Button>
          {edit && (
            <div className="mt-4">
              <DetailsForm
                row={row}
                team={team}
                busy={busy}
                onSave={async (values) => {
                  if (
                    await mutate({
                      action: "details",
                      version: record.version,
                      ...values,
                    })
                  )
                    setEdit(false);
                }}
              />
            </div>
          )}
        </div>
      )}
      <TaskGroup
        title="Publicidade · primeiros passos"
        cycle="initial"
        keys={PUBLICITY_KEYS}
        workflow={record.workflow}
        disabled={busy || !record.active}
        onChange={changeTask}
      />
      {Object.keys(record.workflow.months)
        .sort()
        .reverse()
        .map((month) => (
          <TaskGroup
            key={month}
            title={`Publicidade · ${month.slice(5)}/${month.slice(0, 4)}`}
            cycle={month}
            keys={MONTHLY_KEYS}
            workflow={record.workflow}
            disabled={busy || !record.active}
            onChange={changeTask}
          />
        ))}
      {(record.category === "coproducer" ||
        Object.values(record.workflow.coproduction).some(isDone)) && (
        <TaskGroup
          title={`Coprodução${record.category !== "coproducer" ? " · arquivada" : ""}`}
          cycle="coproduction"
          keys={COPRODUCTION_KEYS}
          workflow={record.workflow}
          disabled={busy || !record.active || record.category !== "coproducer"}
          onChange={changeTask}
        />
      )}
      <section>
        <h3 className="mb-3 font-semibold">Observações e histórico</h3>
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await mutate({ action: "note", body: note })) setNote("");
          }}
        >
          <Textarea
            aria-label="Nova observação"
            placeholder="Feedback, próximos passos ou contexto da parceria…"
            value={note}
            maxLength={5000}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={busy || !note.trim()}
          >
            Adicionar observação
          </Button>
        </form>
        <div className="mt-5 space-y-4">
          {history.isError && (
            <Button variant="outline" onClick={() => void history.refetch()}>
              Recarregar histórico
            </Button>
          )}
          {history.data?.map((event) => (
            <article key={event.id} className="border-l-2 pl-3 text-sm">
              <p className="whitespace-pre-wrap">{eventDescription(event)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {event.authorEmail} ·{" "}
                {new Date(event.createdAt).toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                })}
              </p>
            </article>
          ))}
        </div>
      </section>
      {record.active && (
        <section className="border-t pt-4">
          {ending ? (
            <div className="space-y-3">
              <p className="text-sm">
                Encerrar esta parceria? Novos ciclos deixam de ser criados.
                Histórico, pendências e Starter até o vencimento ficam
                preservados.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    void mutate({ action: "end", version: record.version })
                  }
                >
                  Confirmar encerramento
                </Button>
                <Button variant="outline" onClick={() => setEnding(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setEnding(true)}>
              Encerrar parceria
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
function TaskGroup({
  title,
  cycle,
  keys,
  workflow,
  disabled,
  onChange,
}: {
  title: string;
  cycle: string;
  keys: TaskKey[];
  workflow: AmbassadorWorkflow;
  disabled: boolean;
  onChange: (change: TaskChange) => Promise<boolean>;
}) {
  return (
    <section>
      <h3 className="mb-3 font-semibold">{title}</h3>
      <div className="divide-y rounded-lg border">
        {keys.map((key) => (
          <TaskRow
            key={`${cycle}-${key}`}
            taskKey={key}
            cycle={cycle}
            workflow={workflow}
            disabled={disabled}
            onChange={onChange}
          />
        ))}
      </div>
    </section>
  );
}
function TaskRow({
  taskKey,
  cycle,
  workflow,
  disabled,
  onChange,
}: {
  taskKey: TaskKey;
  cycle: string;
  workflow: AmbassadorWorkflow;
  disabled: boolean;
  onChange: (change: TaskChange) => Promise<boolean>;
}) {
  const task = getTasks(workflow, cycle)![taskKey]!;
  const [expanded, setExpanded] = useState(false);
  const [date, setDate] = useState(todayInBrazil());
  const [scheduled, setScheduled] = useState(task.scheduledOn ?? "");
  const done = isDone(task);
  const missing = missingDependencies(workflow, { cycle, key: taskKey });
  const canSchedule = !AUTOMATIC_DUE_KEYS.includes(taskKey);
  const ready =
    !missing.length &&
    (taskKey !== "publication" ||
      Boolean(task.dueOn && task.dueOn <= todayInBrazil()));
  const overdue = !done && task.dueOn && task.dueOn < todayInBrazil();
  return (
    <div className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            {done ? "✓ " : ""}
            {TASK_LABELS[taskKey]}
            {task.skipped && " · Não se aplica"}
          </p>
          <p
            className={`mt-1 text-xs ${overdue ? "text-destructive" : "text-muted-foreground"}`}
          >
            {done
              ? `Realizada em ${dateLabel(task.completedOn)}`
              : task.dueOn
                ? `${overdue ? "Atrasada · " : "Prazo: "}${dateLabel(task.dueOn)}`
                : "Pendente"}
            {task.scheduledOn
              ? ` · Agendada: ${dateLabel(task.scheduledOn)}`
              : ""}
          </p>
          {!done && missing.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Aguardando {missing.map((dep) => TASK_LABELS[dep.key]).join(", ")}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            setDate(task.completedOn ?? todayInBrazil());
            setScheduled(task.scheduledOn ?? "");
            setExpanded(!expanded);
          }}
        >
          {expanded ? "Fechar" : done ? "Editar" : "Atualizar"}
        </Button>
      </div>
      {expanded && (
        <div className="mt-3 space-y-3">
          {canSchedule && (!done || taskKey === "publication_date") && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Data agendada">
                <Input
                  type="date"
                  value={scheduled}
                  onChange={(e) => setScheduled(e.target.value)}
                />
              </Field>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || !scheduled}
                onClick={() =>
                  void onChange({
                    cycle,
                    key: taskKey,
                    operation: "schedule",
                    date: scheduled,
                  })
                }
              >
                Salvar agendamento
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Data real de realização">
              <Input
                type="date"
                value={date}
                max={todayInBrazil()}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Button
              size="sm"
              disabled={
                disabled ||
                !date ||
                (!done &&
                  (!ready ||
                    (taskKey === "publication_date" && !task.scheduledOn)))
              }
              onClick={async () => {
                if (
                  await onChange({
                    cycle,
                    key: taskKey,
                    operation: done ? "correct" : "complete",
                    date,
                  })
                )
                  setExpanded(false);
              }}
            >
              {done ? "Corrigir data" : "Concluir"}
            </Button>
            {!done && MATERIAL_KEYS.includes(taskKey) && (
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || !ready}
                onClick={() =>
                  void onChange({
                    cycle,
                    key: taskKey,
                    operation: "skip",
                    date,
                  })
                }
              >
                Não se aplica
              </Button>
            )}
            {done && (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  void onChange({ cycle, key: taskKey, operation: "reopen" })
                }
              >
                Desfazer conclusão
              </Button>
            )}
          </div>
          {taskKey === "presentation" && (
            <p className="text-xs text-muted-foreground">
              Planeje a apresentação entre 7 e 10 dias após o brainstorm.
            </p>
          )}
          {taskKey === "publication" && !ready && !missing.length && (
            <p className="text-xs text-muted-foreground">
              A conclusão fica disponível no dia agendado para a publicação.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
function eventDescription(event: History[number]): string {
  if (event.action === "note") return String(event.details.body);
  if (event.action === "created") return "Embaixador adicionado.";
  if (event.action === "end") return "Parceria encerrada.";
  if (event.action === "starter")
    return `Starter liberado/prorrogado até ${dateLabel(String(event.details.expiresOn))}.`;
  if (event.action === "details")
    return "Categoria ou responsáveis atualizados.";
  const change = event.details.change as TaskChange | undefined;
  const verbs = {
    schedule: "Agendamento",
    complete: "Conclusão",
    correct: "Correção de data",
    skip: "Não se aplica",
    reopen: "Conclusão desfeita",
  };
  return change
    ? `${verbs[change.operation]}: ${TASK_LABELS[change.key]} (${change.cycle === "initial" ? "inicial" : change.cycle === "coproduction" ? "coprodução" : change.cycle})${change.date ? ` · ${dateLabel(change.date)}` : ""}.`
    : "Alteração registrada.";
}
