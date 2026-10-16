/**
 * UM estado de filtro para Fila e Mesa, guardado na URL (as duas rotas leem
 * a mesma query string). Só `dias` vai ao servidor; o resto troca com
 * history.replaceState (o Next sincroniza useSearchParams) e é aplicado no
 * navegador. A carteira (Meus/consultor/Todos) é preferência do navegador.
 */
import { isCoreSegment, type AccessSegment } from "@/lib/consultant-workspace/access";
import { PROBLEM_TAG_BY_KEY, type ClientJourney, type JourneyStage } from "@/lib/consultant-workspace/journey";
import { PLAN_RANK } from "@/lib/consultant-workspace/metrics";
import type { MetaHealth } from "@/lib/consultant-workspace/types";
import { parseDays } from "@/components/consultant-workspace/common/routes";
import type { CarteiraRow, PlanGroup } from "@/components/consultant-workspace/common/model";

export type ViewMode = "fila" | "tabela";
export type SortDir = "asc" | "desc";

export type SavedViewKey =
  | "precisa"
  | "todos"
  | "premium_pro"
  | "fora_meta"
  | "sem_meta"
  | "sem_resultado"
  | "sem_entrega"
  | "conexao"
  | "sem_toque"
  | "trial"
  | "cancelado"
  | "inadimplente"
  | "manual";

export type SortKey =
  | "prioridade"
  | "cliente"
  | "etapa"
  | "problemas"
  | "plano"
  | "responsavel"
  | "gasto"
  | "gastoAnterior"
  | "gastoMes"
  | "ritmo"
  | "resultado"
  | "custo"
  | "roas"
  | "meta"
  | "tendencia"
  | "conexao"
  | "alertas"
  | "toque";

export const SORT_LABEL: Record<SortKey, string> = {
  prioridade: "Prioridade",
  cliente: "Cliente",
  etapa: "Etapa",
  problemas: "Problemas",
  plano: "Plano",
  responsavel: "Responsável",
  gasto: "Gasto",
  gastoAnterior: "Gasto anterior",
  gastoMes: "Gasto no mês",
  ritmo: "Ritmo da verba",
  resultado: "Resultado",
  custo: "Custo por resultado",
  roas: "ROAS",
  meta: "Custo vs meta",
  tendencia: "Tendência",
  conexao: "Conexão",
  alertas: "Alertas",
  toque: "Dias sem toque",
};

export const DEFAULT_DIR: Record<SortKey, SortDir> = {
  prioridade: "desc",
  cliente: "asc",
  etapa: "asc",
  problemas: "desc",
  plano: "asc",
  responsavel: "asc",
  gasto: "desc",
  gastoAnterior: "desc",
  gastoMes: "desc",
  ritmo: "desc",
  resultado: "desc",
  custo: "desc",
  roas: "desc",
  meta: "desc",
  tendencia: "desc",
  conexao: "asc",
  alertas: "desc",
  toque: "asc",
};

/** O que a Fila oferece no seletor de ordem (a Mesa ordena por qualquer coluna). */
export const FILA_SORTS: SortKey[] = ["prioridade", "gasto", "meta", "toque", "etapa"];

export type SavedView = {
  key: SavedViewKey;
  label: string;
  hint: string;
  empty: string;
  filter: (row: CarteiraRow) => boolean;
  sort: { key: SortKey; dir: SortDir };
  tone?: "bad" | "warn" | "primary";
  /**
   * Grupo de acesso que a visão mostra. Sem isso, a visão trabalha no universo
   * principal (os pagantes em dia, ver `CORE_SEGMENTS`).
   */
  segment?: AccessSegment;
};

export const SAVED_VIEWS: SavedView[] = [
  {
    key: "precisa",
    label: "Precisa de você",
    hint: "O que depende de gente pelo que o plano promete: Premium tudo, Pro só problema, Starter só exceção. Mais urgente primeiro.",
    empty: "Nada precisa de você com esses filtros.",
    filter: (row) => row.bucket === "fila",
    sort: { key: "prioridade", dir: "desc" },
    tone: "primary",
  },
  {
    key: "todos",
    label: "Todos ativos",
    hint: "Pagantes em dia: assinatura ativa e acesso válido. Trial, cancelados e pagamento atrasado ficam nas visões próprias. Quem tem sinal aberto primeiro.",
    empty: "Nenhum cliente ativo com esses filtros.",
    filter: () => true,
    sort: { key: "prioridade", dir: "desc" },
  },
  {
    key: "premium_pro",
    label: "Premium & Pro",
    hint: "Quem comprou atendimento: gerente dedicado (Premium) e suporte por WhatsApp (Pro).",
    empty: "Nenhum cliente Premium ou Pro com esses filtros.",
    filter: (row) => row.planGroup === "premium" || row.planGroup === "pro",
    sort: { key: "plano", dir: "asc" },
  },
  {
    key: "fora_meta",
    label: "Fora da meta",
    hint: "Custo por resultado (ou ROAS) mais de 10% pior que a meta combinada. Pior primeiro.",
    empty: "Ninguém fora da meta — ou ainda há poucas metas definidas. Veja “Sem meta definida”.",
    filter: (row) => row.goalInfo.status === "fora",
    sort: { key: "meta", dir: "desc" },
    tone: "bad",
  },
  {
    key: "sem_meta",
    label: "Sem meta definida",
    hint: "Sem meta combinada não dá para dizer se está bom ou ruim. Na Fila, aperte m em cada um.",
    empty: "Todos os clientes desta seleção têm meta.",
    filter: (row) => !row.goal,
    sort: { key: "plano", dir: "asc" },
  },
  {
    key: "sem_resultado",
    label: "Gastando sem resultado",
    hint: "Gastou no período e não trouxe nenhum resultado. Maior gasto primeiro.",
    empty: "Nenhuma conta gastando sem resultado no período.",
    filter: (row) => row.client.perf.current.spend > 0 && row.client.perf.kpi.count === 0,
    sort: { key: "gasto", dir: "desc" },
    tone: "bad",
  },
  {
    key: "sem_entrega",
    label: "Sem entrega",
    hint: "Gastou no período anterior e nada neste — campanha parou, saldo acabou ou conta travou.",
    empty: "Nenhuma conta parou de entregar no período.",
    filter: (row) => row.client.perf.current.spend === 0 && row.client.perf.previous.spend > 0,
    sort: { key: "gastoAnterior", dir: "desc" },
    tone: "warn",
  },
  {
    key: "conexao",
    label: "Conexão quebrada",
    hint: "Precisa reconectar a Meta ou a leitura da conta está falhando.",
    empty: "Todas as conexões com a Meta estão ok.",
    filter: (row) => row.client.meta.health === "token_invalido" || row.client.meta.health === "erro_checagem",
    sort: { key: "plano", dir: "asc" },
    tone: "bad",
  },
  {
    key: "sem_toque",
    label: "Sem toque há 14 dias",
    hint: "Premium e Pro sem contato, nota ou ação registrada há mais de 14 dias. Mais esquecido primeiro.",
    empty: "Todos os Premium e Pro tiveram contato nos últimos 14 dias.",
    filter: (row) => row.touchOverdue,
    sort: { key: "toque", dir: "asc" },
    tone: "warn",
  },
  {
    key: "trial",
    label: "Em trial",
    hint: "Em teste, com acesso válido. Fora do número de ativos até a primeira cobrança.",
    empty: "Ninguém em trial com esses filtros.",
    filter: () => true,
    sort: { key: "etapa", dir: "asc" },
    segment: "trial",
  },
  {
    key: "cancelado",
    label: "Cancelaram",
    hint: "Cancelaram a assinatura e ainda estão dentro do período pago. Acesso acaba na data de vencimento.",
    empty: "Nenhum cancelado ainda com acesso.",
    filter: () => true,
    sort: { key: "gasto", dir: "desc" },
    segment: "cancelado",
  },
  {
    key: "inadimplente",
    label: "Pagamento atrasado",
    hint: "A cobrança falhou e o acesso venceu há até 15 dias (ou vence logo). A Stripe ainda está tentando cobrar.",
    empty: "Nenhum pagamento atrasado recente.",
    filter: () => true,
    sort: { key: "gasto", dir: "desc" },
    tone: "warn",
    segment: "inadimplente",
  },
  {
    key: "manual",
    label: "Acesso manual",
    hint: "Acesso liberado à mão, sem assinatura viva.",
    empty: "Ninguém com acesso manual.",
    filter: () => true,
    sort: { key: "cliente", dir: "asc" },
    segment: "manual",
  },
];

/** O universo de onde a visão tira as linhas: o grupo dela ou o principal. */
export function inViewUniverse(view: Pick<SavedView, "segment">, row: { client: { access: AccessSegment } }) {
  return view.segment ? row.client.access === view.segment : isCoreSegment(row.client.access);
}

const VIEW_BY_KEY = new Map(SAVED_VIEWS.map((view) => [view.key, view]));
const SORT_KEYS = Object.keys(DEFAULT_DIR) as SortKey[];
const STAGES: JourneyStage[] = ["onboarding", "rodando", "parado"];
const PLANS: PlanGroup[] = ["premium", "pro", "starter"];

/** Opção extra do filtro "Problema": onboarding sem a passagem de bastão do Fred. */
export const NO_HANDOFF_TAG = "sem_fred";
export const NO_HANDOFF_LABEL = "Sem passagem do Fred";

export function isProblemFilter(value: string | null | undefined): value is string {
  return !!value && (value === NO_HANDOFF_TAG || PROBLEM_TAG_BY_KEY.has(value));
}

/** O filtro "Problema" (tag de problema ou "sem passagem do Fred") vale para este cliente? */
export function matchesProblem(journey: Pick<ClientJourney, "stage" | "handoff" | "tags">, tag: string | null) {
  if (!tag) return true;
  if (tag === NO_HANDOFF_TAG) return journey.stage === "onboarding" && !journey.handoff;
  return journey.tags.some((entry) => entry.key === tag);
}

/** Contagem por opção do filtro "Problema" (inclui "sem passagem do Fred"). */
export function problemCounts(journeys: Iterable<Pick<ClientJourney, "stage" | "handoff" | "tags">>) {
  const counts: Record<string, number> = {};
  for (const journey of journeys) {
    for (const tag of journey.tags) counts[tag.key] = (counts[tag.key] ?? 0) + 1;
    if (journey.stage === "onboarding" && !journey.handoff) counts[NO_HANDOFF_TAG] = (counts[NO_HANDOFF_TAG] ?? 0) + 1;
  }
  return counts;
}

export type Filters = {
  days: number;
  plan: PlanGroup | null;
  stage: JourneyStage | null;
  tag: string | null;
  view: SavedView;
  q: string;
  sortKey: SortKey;
  sortDir: SortDir;
  /** A ordem veio da URL (escolhida) ou é a padrão da visão. */
  sortExplicit: boolean;
};

type ParamsLike = { get(name: string): string | null };

export function parseFilters(params: ParamsLike): Filters {
  const view = VIEW_BY_KEY.get(params.get("filtro") as SavedViewKey) ?? SAVED_VIEWS[0];
  const ord = params.get("ord") as SortKey | null;
  const explicit = !!ord && SORT_KEYS.includes(ord);
  const sortKey = explicit ? ord! : view.sort.key;
  const dirParam = params.get("dir");
  const sortDir: SortDir = explicit
    ? dirParam === "asc" || dirParam === "desc"
      ? dirParam
      : DEFAULT_DIR[sortKey]
    : view.sort.dir;
  const plan = params.get("plano") as PlanGroup | null;
  const stage = params.get("etapa") as JourneyStage | null;
  const tag = params.get("tag");
  return {
    days: parseDays(params.get("dias")),
    plan: plan && PLANS.includes(plan) ? plan : null,
    stage: stage && STAGES.includes(stage) ? stage : null,
    tag: isProblemFilter(tag) ? tag : null,
    view,
    q: params.get("q") ?? "",
    sortKey,
    sortDir,
    sortExplicit: explicit,
  };
}

/** Atualiza a URL sem ir ao servidor. */
export function replaceParams(mutate: (params: URLSearchParams) => void) {
  const params = new URLSearchParams(window.location.search);
  mutate(params);
  const query = params.toString();
  // `null` (e não history.state): o Next ignora o replaceState que carrega o estado interno dele
  // e aí useSearchParams não sincroniza.
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}


/* ------------------------------------------------------------------ */
/* Ordenação                                                           */
/* ------------------------------------------------------------------ */

const STAGE_RANK: Record<JourneyStage, number> = { onboarding: 0, parado: 1, rodando: 2 };
const HEALTH_RANK: Record<MetaHealth, number> = {
  token_invalido: 0,
  erro_checagem: 1,
  checagem_velha: 2,
  sem_meta: 3,
  ok: 4,
};
const GOAL_RANK = { fora: 0, perto: 1, sem_dados: 2, na_meta: 3, sem_meta: 4 } as const;

export function sortValue(row: CarteiraRow, key: SortKey): number | string | null {
  const { client } = row;
  switch (key) {
    case "prioridade":
      return row.score;
    case "cliente":
      return row.title.toLocaleLowerCase("pt-BR");
    case "etapa":
      return STAGE_RANK[row.journey.stage] * 100_000 - (row.journey.daysInStage ?? 0);
    case "problemas":
      return row.journey.tags.length;
    case "plano":
      return PLAN_RANK[client.plan.tier];
    case "responsavel":
      return row.consultantName?.toLocaleLowerCase("pt-BR") ?? (row.consultant ? "~" : null);
    case "gasto":
      return client.perf.current.spend;
    case "gastoAnterior":
      return client.perf.previous.spend;
    case "gastoMes":
      return client.perf.monthToDateSpend;
    case "ritmo":
      return row.pacing ? Math.abs(row.pacing.ratio - 1) : null;
    case "resultado":
      return client.perf.kpi.count;
    case "custo":
      return client.perf.kpi.cost;
    case "roas":
      return client.perf.kpi.roas;
    case "meta":
      return row.goalInfo.ratio ?? (row.goal ? -GOAL_RANK[row.goalInfo.status] : null);
    case "tendencia":
      return row.spendDelta;
    case "conexao":
      return HEALTH_RANK[client.meta.health];
    case "alertas":
      return row.alertCounts.critical * 10_000 + row.alertCounts.warning * 100 + row.alertCounts.info;
    case "toque":
      // Nunca tocado = o mais esquecido.
      return row.daysSinceTouch == null ? -Infinity : -row.daysSinceTouch;
  }
}

/** Nulos sempre no fim, qualquer que seja a direção. */
export function compareNullable(a: number | string | null, b: number | string | null, dir: SortDir) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const result = typeof a === "string" && typeof b === "string" ? a.localeCompare(b, "pt-BR") : Number(a) - Number(b);
  return dir === "asc" ? result : -result;
}

export function sortRows(rows: CarteiraRow[], key: SortKey, dir: SortDir) {
  return [...rows].sort(
    (a, b) =>
      compareNullable(sortValue(a, key), sortValue(b, key), dir) ||
      b.score - a.score ||
      b.client.perf.current.spend - a.client.perf.current.spend ||
      a.title.localeCompare(b.title, "pt-BR"),
  );
}
