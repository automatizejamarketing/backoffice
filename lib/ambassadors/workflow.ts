import { z } from "zod";

export const TASK_LABELS = {
  formalization: "Formalização",
  onboarding: "Reunião de onboarding",
  feedback: "Checagem de feedback",
  publication_date: "Data da publi",
  briefing: "Enviar briefing",
  publication: "Publi feita",
  brainstorm: "Reunião de brainstorm",
  presentation: "Apresentação do projeto",
  landing_page: "Landing page",
  vsl: "VSL",
  creatives: "Criativos",
  product: "Produto",
  start: "Start",
} as const;
export type TaskKey = keyof typeof TASK_LABELS;
export const AUTOMATIC_DUE_KEYS: TaskKey[] = [
  "feedback",
  "briefing",
  "publication",
];
export const PUBLICITY_KEYS: TaskKey[] = [
  "formalization",
  "onboarding",
  "feedback",
  "publication_date",
  "briefing",
  "publication",
];
export const MONTHLY_KEYS: TaskKey[] = [
  "publication_date",
  "briefing",
  "publication",
];
export const COPRODUCTION_KEYS: TaskKey[] = [
  "brainstorm",
  "presentation",
  "landing_page",
  "vsl",
  "creatives",
  "product",
  "start",
];
export const MATERIAL_KEYS: TaskKey[] = [
  "landing_page",
  "vsl",
  "creatives",
  "product",
];
export type AmbassadorTask = {
  scheduledOn: string | null;
  scheduledAt: string | null;
  dueOn: string | null;
  completedOn: string | null;
  skipped: boolean;
};
export type TaskSet = Partial<Record<TaskKey, AmbassadorTask>>;
export type AmbassadorWorkflow = {
  initial: TaskSet;
  coproduction: TaskSet;
  months: Record<string, TaskSet>;
};
export function todayInBrazil(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function isDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export const calendarDate = z.string().refine(isDate, "Data inválida");
export function shiftDays(value: string, amount: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function monthAfter(month: string): string {
  const d = new Date(`${month}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
}
/** Clamp short months, always using the original day (Jan 31 -> Feb 28 -> Mar 31). */
export function cycleDate(anchor: string, month: string): string {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(Number(anchor.slice(8)), last)).padStart(2, "0")}`;
}
export function nextCreditDate(anchor: string, after: string): string {
  const same = cycleDate(anchor, after.slice(0, 7));
  return same > after ? same : cycleDate(anchor, monthAfter(after.slice(0, 7)));
}
function taskSet(keys: TaskKey[]): TaskSet {
  return Object.fromEntries(
    keys.map((key) => [
      key,
      {
        scheduledOn: null,
        scheduledAt: null,
        dueOn: null,
        completedOn: null,
        skipped: false,
      },
    ]),
  );
}
export function newWorkflow(): AmbassadorWorkflow {
  return {
    initial: taskSet(PUBLICITY_KEYS),
    coproduction: taskSet(COPRODUCTION_KEYS),
    months: {},
  };
}
export type TaskRef = { cycle: string; key: TaskKey };
export function getTasks(
  state: AmbassadorWorkflow,
  cycle: string,
): TaskSet | undefined {
  return cycle === "initial"
    ? state.initial
    : cycle === "coproduction"
      ? state.coproduction
      : state.months[cycle];
}
export function isDone(task: AmbassadorTask | undefined): boolean {
  return Boolean(task?.completedOn || task?.skipped);
}
export function dependencies(ref: TaskRef): TaskRef[] {
  const same = (key: TaskKey): TaskRef => ({ cycle: ref.cycle, key });
  const initial = (key: TaskKey): TaskRef => ({ cycle: "initial", key });
  switch (ref.key) {
    case "formalization":
      return [];
    case "onboarding":
    case "brainstorm":
      return [initial("formalization")];
    case "feedback":
      return [initial("onboarding")];
    case "publication_date":
      return [initial(ref.cycle === "initial" ? "feedback" : "publication")];
    case "briefing":
      return [same("publication_date")];
    case "publication":
      return [same("briefing")];
    case "presentation":
      return [same("brainstorm")];
    case "start":
      return MATERIAL_KEYS.map(same);
    default:
      return [same("presentation")];
  }
}
export function missingDependencies(
  state: AmbassadorWorkflow,
  ref: TaskRef,
): TaskRef[] {
  return dependencies(ref).filter(
    (dep) => !isDone(getTasks(state, dep.cycle)?.[dep.key]),
  );
}
function dependsOn(ref: TaskRef, target: TaskRef): boolean {
  return dependencies(ref).some(
    (dep) =>
      (dep.cycle === target.cycle && dep.key === target.key) ||
      dependsOn(dep, target),
  );
}
function allRefs(state: AmbassadorWorkflow): TaskRef[] {
  return ["initial", "coproduction", ...Object.keys(state.months)].flatMap(
    (cycle) =>
      Object.keys(getTasks(state, cycle) ?? {}).map((key) => ({
        cycle,
        key: key as TaskKey,
      })),
  );
}
export function refreshWorkflow(
  state: AmbassadorWorkflow,
  today: string,
  active: boolean,
): void {
  const firstPublication = state.initial.publication?.completedOn;
  if (firstPublication && active) {
    for (
      let month = monthAfter(firstPublication.slice(0, 7));
      month <= today.slice(0, 7);
      month = monthAfter(month)
    ) {
      state.months[month] ??= taskSet(MONTHLY_KEYS);
    }
  }
  const setDue = (task: AmbassadorTask | undefined, due: string | null) => {
    if (task && !isDone(task)) task.dueOn = due;
  };
  for (const ref of allRefs(state)) {
    const item = getTasks(state, ref.cycle)?.[ref.key];
    if (item?.scheduledOn && !AUTOMATIC_DUE_KEYS.includes(ref.key))
      setDue(item, item.scheduledOn);
  }
  setDue(
    state.initial.onboarding,
    state.initial.onboarding?.scheduledOn ?? null,
  );
  setDue(
    state.initial.feedback,
    state.initial.onboarding?.completedOn
      ? shiftDays(state.initial.onboarding.completedOn, 7)
      : null,
  );
  setDue(
    state.coproduction.brainstorm,
    state.coproduction.brainstorm?.scheduledOn ?? null,
  );
  setDue(
    state.coproduction.presentation,
    state.coproduction.presentation?.scheduledOn ??
      (state.coproduction.brainstorm?.completedOn
        ? shiftDays(state.coproduction.brainstorm.completedOn, 10)
        : null),
  );
  for (const cycle of ["initial", ...Object.keys(state.months)]) {
    const tasks = getTasks(state, cycle)!;
    setDue(
      tasks.publication_date,
      cycle === "initial"
        ? (state.initial.feedback?.completedOn ?? null)
        : `${cycle}-01`,
    );
    const planned = tasks.publication_date?.scheduledOn;
    setDue(tasks.publication, planned ?? null);
    const briefingDue = planned
      ? [shiftDays(planned, -7), tasks.publication_date?.scheduledAt ?? today]
          .sort()
          .at(-1)!
      : null;
    setDue(tasks.briefing, briefingDue);
  }
}
const taskKeys = Object.keys(TASK_LABELS) as [TaskKey, ...TaskKey[]];
export const taskChangeSchema = z
  .object({
    cycle: z
      .string()
      .refine(
        (v) =>
          v === "initial" ||
          v === "coproduction" ||
          /^\d{4}-(0[1-9]|1[0-2])$/.test(v),
      ),
    key: z.enum(taskKeys),
    operation: z.enum(["schedule", "complete", "skip", "reopen", "correct"]),
    date: calendarDate.optional(),
  })
  .strict();
export type TaskChange = z.infer<typeof taskChangeSchema>;
export function changeTask(
  input: AmbassadorWorkflow,
  change: TaskChange,
  today: string,
  category: "ambassador" | "coproducer",
  active: boolean,
): AmbassadorWorkflow {
  if (!active) throw new Error("A parceria está encerrada.");
  if (change.cycle === "coproduction" && category !== "coproducer")
    throw new Error("A trilha de coprodução está arquivada.");
  const state = structuredClone(input);
  const task = getTasks(state, change.cycle)?.[change.key];
  if (!task) throw new Error("Tarefa não encontrada.");
  const date = change.date ?? today;
  if (!isDate(date)) throw new Error("Data inválida.");
  if (change.operation === "schedule") {
    if (AUTOMATIC_DUE_KEYS.includes(change.key))
      throw new Error("Essa tarefa tem prazo automático.");
    if (isDone(task) && change.key !== "publication_date")
      throw new Error("Corrija a data de realização da tarefa concluída.");
    task.scheduledOn = date;
    task.scheduledAt = today;
  } else if (change.operation === "reopen") {
    if (
      allRefs(state).some(
        (ref) =>
          isDone(getTasks(state, ref.cycle)?.[ref.key]) &&
          dependsOn(ref, change),
      )
    )
      throw new Error(
        "Desfaça primeiro as conclusões posteriores que dependem desta etapa.",
      );
    task.completedOn = null;
    task.skipped = false;
  } else {
    if (date > today) throw new Error("A realização não pode estar no futuro.");
    if (change.operation === "correct") {
      if (!isDone(task)) throw new Error("A tarefa ainda não foi concluída.");
    } else {
      if (isDone(task)) throw new Error("A tarefa já está concluída.");
      if (missingDependencies(state, change).length)
        throw new Error("Conclua primeiro a etapa anterior.");
      if (change.operation === "skip" && !MATERIAL_KEYS.includes(change.key))
        throw new Error("Não se aplica é exclusivo dos materiais.");
      if (change.key === "publication_date" && !task.scheduledOn)
        throw new Error("Informe a data da publicação.");
      if (
        change.key === "publication" &&
        (!task.dueOn || today < task.dueOn || date < task.dueOn)
      )
        throw new Error(
          "A publicação só pode ser concluída a partir da data agendada.",
        );
    }
    task.completedOn = date;
    task.skipped =
      change.operation === "skip" ||
      (change.operation === "correct" && task.skipped);
  }
  refreshWorkflow(state, today, active);
  return state;
}
