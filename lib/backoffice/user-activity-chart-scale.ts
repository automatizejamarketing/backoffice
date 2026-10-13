export type UserActivityAxis = {
  domain: [number, number];
  ticks: number[];
};

const TICK_INTERVALS = 4;

function niceAxis(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: TICK_INTERVALS, ticks: [0, 1, 2, 3, 4] };

  const rawStep = max / TICK_INTERVALS;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step =
    [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
      .map((factor) => factor * magnitude)
      .find((candidate) => candidate >= rawStep && Number.isInteger(candidate)) ??
    Math.ceil(rawStep);
  const top = step * TICK_INTERVALS;

  return {
    top,
    ticks: Array.from({ length: TICK_INTERVALS + 1 }, (_, index) => index * step),
  };
}

/**
 * Churn bars go below zero on the daily axis. The stock axis gets the same
 * share of room below zero so both zeros sit on the same line; its ticks stay
 * non-negative because a stock never goes below zero.
 */
export function userActivityAxisScale(input: {
  dailyMax: number;
  churnMax: number;
  stockMax: number;
}): { daily: UserActivityAxis; stock: UserActivityAxis } {
  const daily = niceAxis(input.dailyMax);
  const stock = niceAxis(input.stockMax);
  const churnRoom = input.churnMax > 0 ? input.churnMax * 1.15 : 0;
  const belowZeroShare = churnRoom / daily.top;

  return {
    daily: { domain: [churnRoom > 0 ? -churnRoom : 0, daily.top], ticks: daily.ticks },
    stock: {
      domain: [churnRoom > 0 ? -belowZeroShare * stock.top : 0, stock.top],
      ticks: stock.ticks,
    },
  };
}
