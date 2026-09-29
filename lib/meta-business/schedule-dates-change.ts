/**
 * Sob CBO programada (conta liberada), a troca de horário manda só a grade. Datas e grade
 * na mesma gravação ficam de fora: a combinação não foi validada contra a Meta (Ruling R20).
 */
export const SCHEDULE_WITH_DATES_UNDER_CBO = "SCHEDULE_WITH_DATES_UNDER_CBO";

export function scheduleWithDatesRouteBody(): {
  error: string;
  message: string;
  solution: string;
} {
  return {
    error: SCHEDULE_WITH_DATES_UNDER_CBO,
    message: "Sob orçamento de campanha, datas e horário não mudam na mesma gravação.",
    solution: "Salve primeiro as datas e depois o horário (ou o contrário), em duas gravações.",
  };
}

/** Minuto absoluto do instante (a Meta devolve segundos; o diálogo manda só até o minuto). */
function minuteOf(value?: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 60_000);
}

function dateChanged(requested: string | undefined, current?: string | null): boolean {
  if (requested === undefined) return false;
  return minuteOf(requested) !== minuteOf(current);
}

/**
 * A mesma gravação muda o horário E muda `start_time` ou `end_time` (diferente do conjunto
 * atual). Datas iguais às atuais, reenviadas junto com a grade, não contam.
 */
export function scheduleAndDatesChangedTogether(args: {
  hasDeliveryScheduleChange: boolean;
  startTime?: string;
  endTime?: string;
  current: { startTime?: string | null; endTime?: string | null };
}): boolean {
  if (!args.hasDeliveryScheduleChange) return false;
  return (
    dateChanged(args.startTime, args.current.startTime) ||
    dateChanged(args.endTime, args.current.endTime)
  );
}
