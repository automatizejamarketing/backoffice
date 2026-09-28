/**
 * Onde vai a programação de anúncios (dias e horários) de um conjunto — regra única da
 * etapa 2 da investigação "campanhas param de veicular" (28/09/2026).
 *
 * Sob orçamento de campanha (Advantage campaign budget, "CBO") a documentação manda o
 * `pacing_type` para a CAMPANHA ("Define the pacing_type in the campaign level, not in
 * the ad set level") e a grade (`adset_schedule`) fica em cada conjunto. Nos dados da
 * Meta, trocar a grade de um conjunto cuja campanha nasceu com `day_parting` nunca parou
 * a entrega (0 de 9); com a campanha em `standard` e a programação no conjunto, parou
 * sempre (17 de 17). Relatório: docs/research/2026-09-28-meta-cbo-horario-criacao-e-edicao.md.
 *
 * Idêntico byte a byte nos dois repositórios e puro (sem rede, sem `process.env`): pode
 * ser importado por telas. A liberação por conta fica em `cbo-dayparting-release.ts`.
 */

export type AdSetScheduleBlock = {
  days: number[];
  start_minute: number;
  end_minute: number;
  timezone_type?: "USER" | "ADVERTISER";
};

/**
 * "O dia todo" numa campanha programada: a Meta exige grade em todo conjunto de uma
 * campanha com `day_parting` e recusa a grade vazia (subcódigo 2446063).
 */
export const FULL_WEEK_ADSET_SCHEDULE: AdSetScheduleBlock[] = [
  { days: [0, 1, 2, 3, 4, 5, 6], start_minute: 0, end_minute: 1440 },
];

const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];

type GraphScheduleBlock = { days?: number[]; start_minute?: number; end_minute?: number };

/** Grade que cobre a semana inteira, 00:00–24:00 todo dia (1 bloco com os 7 dias ou 7 blocos). */
export function isFullWeekSchedule(
  blocks: GraphScheduleBlock[] | null | undefined,
): boolean {
  if (!Array.isArray(blocks) || blocks.length === 0) return false;
  const covered = new Set<number>();
  for (const block of blocks) {
    if (block.start_minute !== 0 || block.end_minute !== 1440) return false;
    if (!Array.isArray(block.days) || block.days.length === 0) return false;
    for (const day of block.days) covered.add(day);
  }
  return WEEK_DAYS.every((day) => covered.has(day));
}

/** `pacing_type` da Graph (array ou string) como lista; `undefined` quando ausente. */
export function normalizePacingType(
  pacing: string[] | string | null | undefined,
): string[] | undefined {
  if (pacing == null) return undefined;
  const list = (Array.isArray(pacing) ? pacing : [pacing]).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return list.length > 0 ? list : undefined;
}

export function pacingIncludesDayParting(
  pacing: string[] | string | null | undefined,
): boolean {
  return normalizePacingType(pacing)?.includes("day_parting") ?? false;
}

export type CampaignScheduleShape = {
  /** Onde está o orçamento: na campanha (CBO) ou nos conjuntos (ABO). */
  budgetLevel: "campaign" | "adset";
  /** Tipo do orçamento no nível que o tem; `null` quando desconhecido. */
  budgetKind: "lifetime" | "daily" | null;
  /** A campanha tem `day_parting` no `pacing_type` (programação na campanha). */
  dayParting: boolean;
  /** Estratégia de lance da campanha: `COST_CAP` exige pacing padrão. */
  bidStrategy?: string | null;
};

function positive(value: string | number | null | undefined): boolean {
  if (value == null || value === "") return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

export function campaignScheduleShapeFromGraph(
  campaign:
    | {
        daily_budget?: string | null;
        lifetime_budget?: string | null;
        pacing_type?: string[] | string | null;
        bid_strategy?: string | null;
      }
    | null
    | undefined,
  adSet?: { daily_budget?: string | null; lifetime_budget?: string | null } | null,
): CampaignScheduleShape {
  const c = campaign ?? {};
  const dayParting = pacingIncludesDayParting(c.pacing_type);
  const bidStrategy = c.bid_strategy ?? null;
  if (positive(c.lifetime_budget) || positive(c.daily_budget)) {
    return {
      budgetLevel: "campaign",
      budgetKind: positive(c.lifetime_budget) ? "lifetime" : "daily",
      dayParting,
      bidStrategy,
    };
  }
  return {
    budgetLevel: "adset",
    budgetKind: positive(adSet?.lifetime_budget)
      ? "lifetime"
      : positive(adSet?.daily_budget)
        ? "daily"
        : null,
    dayParting,
    bidStrategy,
  };
}

export type RequestedSchedule =
  | { mode: "all_day" }
  | { mode: "specific_hours"; blocks: AdSetScheduleBlock[] };

export type ScheduleRefusalCode =
  | "SCHEDULE_LOCKED_UNDER_CBO"
  | "SCHEDULE_NEEDS_PROGRAMMED_CAMPAIGN"
  | "DAYPARTING_REQUIRES_LIFETIME"
  | "SCHEDULE_NEEDS_STANDARD_PACING_BID";

export type ScheduleFields = {
  pacing_type?: string[];
  adset_schedule?: AdSetScheduleBlock[];
};

export type ScheduleFieldsDecision =
  | { ok: true; fields: ScheduleFields }
  | { ok: false; code: ScheduleRefusalCode; message: string; solution: string };

export const SCHEDULE_REFUSALS: Record<
  ScheduleRefusalCode,
  { message: string; solution: string }
> = {
  SCHEDULE_LOCKED_UNDER_CBO: {
    message:
      "Os dias e horários deste conjunto não podem ser alterados porque a campanha usa orçamento de campanha. A Meta aceita a mudança, mas o conjunto para de veicular de vez.",
    solution:
      "Duplique a campanha já com o novo horário (Duplicar com novo horário) e depois pause a original.",
  },
  SCHEDULE_NEEDS_PROGRAMMED_CAMPAIGN: {
    message:
      "Esta campanha usa orçamento de campanha e foi criada sem programação de horário. A Meta só aceita dias e horários em campanhas que já nascem programadas, então este conjunto só pode veicular o dia todo.",
    solution:
      "Para veicular em horários específicos, duplique a campanha com novo horário (Duplicar com novo horário): a cópia já nasce programada e aceita mudar o horário depois.",
  },
  DAYPARTING_REQUIRES_LIFETIME: {
    message: "Dias e horários específicos só funcionam com orçamento total (vitalício).",
    solution: "Troque para orçamento total ou veicule o dia todo.",
  },
  SCHEDULE_NEEDS_STANDARD_PACING_BID: {
    message:
      "Com a estratégia de lance por custo máximo (cost cap), a Meta exige veiculação padrão, sem programação de horário.",
    solution:
      "Use a estratégia de menor custo (sem limite) para veicular em horários específicos, ou veicule o dia todo.",
  },
};

function refuse(code: ScheduleRefusalCode): ScheduleFieldsDecision {
  return { ok: false, code, ...SCHEDULE_REFUSALS[code] };
}

/** Receita documentada para orçamento NO CONJUNTO (e o formato antigo sob CBO). */
function adSetLevelFields(requested: RequestedSchedule): ScheduleFields {
  return requested.mode === "specific_hours"
    ? { pacing_type: ["day_parting"], adset_schedule: requested.blocks }
    : {};
}

/** Campanha programada: o conjunto leva só a grade (24h x 7 no "o dia todo"). */
function gridOnlyFields(requested: RequestedSchedule): ScheduleFields {
  return {
    adset_schedule:
      requested.mode === "specific_hours" ? requested.blocks : FULL_WEEK_ADSET_SCHEDULE,
  };
}

/** `COST_CAP` exige pacing padrão: nunca programação de horário na campanha. */
export const requiresStandardPacing = (bidStrategy?: string | null): boolean =>
  bidStrategy === "COST_CAP";

/** `pacing_type` de uma campanha NOVA: `["day_parting"]` só para CBO vitalício liberado e sem COST_CAP. */
export function campaignPacingForNewCampaign(args: {
  budgetLevel: "campaign" | "adset";
  budgetKind: "lifetime" | "daily" | null;
  bidStrategy?: string | null;
  released: boolean;
}): string[] | undefined {
  if (!args.released) return undefined;
  if (args.budgetLevel !== "campaign" || args.budgetKind !== "lifetime") return undefined;
  if (requiresStandardPacing(args.bidStrategy)) return undefined;
  return ["day_parting"];
}

/** Sob CBO, o horário só é editável quando a campanha nasceu programada e a conta está liberada. */
export function cboScheduleEditable(
  shape: CampaignScheduleShape,
  released: boolean,
): boolean {
  return (
    released &&
    shape.budgetLevel === "campaign" &&
    shape.budgetKind === "lifetime" &&
    shape.dayParting
  );
}

/** Campos de horário de um conjunto NOVO sob a campanha `parent`. */
export function adSetScheduleForCreate(
  parent: CampaignScheduleShape,
  requested: RequestedSchedule,
  released: boolean,
): ScheduleFieldsDecision {
  const specific = requested.mode === "specific_hours";
  if (parent.budgetKind !== "lifetime") {
    return specific ? refuse("DAYPARTING_REQUIRES_LIFETIME") : { ok: true, fields: {} };
  }
  if (parent.budgetLevel === "adset" || !released) {
    return { ok: true, fields: adSetLevelFields(requested) };
  }
  if (parent.dayParting) return { ok: true, fields: gridOnlyFields(requested) };
  if (!specific) return { ok: true, fields: {} };
  return refuse(
    requiresStandardPacing(parent.bidStrategy)
      ? "SCHEDULE_NEEDS_STANDARD_PACING_BID"
      : "SCHEDULE_NEEDS_PROGRAMMED_CAMPAIGN",
  );
}

/** Campos de uma TROCA de horário de conjunto publicado. */
export function adSetScheduleForEdit(
  parent: CampaignScheduleShape,
  requested: RequestedSchedule,
  released: boolean,
): ScheduleFieldsDecision {
  if (parent.budgetLevel === "campaign") {
    return cboScheduleEditable(parent, released)
      ? { ok: true, fields: gridOnlyFields(requested) }
      : refuse("SCHEDULE_LOCKED_UNDER_CBO");
  }
  if (requested.mode === "specific_hours") {
    return parent.budgetKind === "lifetime"
      ? { ok: true, fields: { pacing_type: ["day_parting"], adset_schedule: requested.blocks } }
      : refuse("DAYPARTING_REQUIRES_LIFETIME");
  }
  return { ok: true, fields: { pacing_type: ["standard"], adset_schedule: [] } };
}
