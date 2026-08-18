export type PayerRetentionCohortCounts = {
  weekStart: string;
  initialPayers: number;
  activeToday: number;
};

export type PayerRetentionCellCounts = {
  weekStart: string;
  ageWeeks: number;
  retainedPayers: number;
};

export type PayerRetentionCell = PayerRetentionCellCounts & {
  initialPayers: number;
  retentionRate: number;
};

export type PayerRetentionCohort = PayerRetentionCohortCounts & {
  inactiveToday: number;
  retentionRate: number;
  retention: PayerRetentionCell[];
};

export type PayerRetentionSummary = {
  cohorts: PayerRetentionCohort[];
  totalPayers: number;
  activeToday: number;
  retentionRate: number;
};

function percentage(value: number, total: number) {
  if (total === 0) return 0;
  return Math.round((value / total) * 1000) / 10;
}

export function summarizePayerRetentionCohorts(
  rows: PayerRetentionCohortCounts[],
  retentionRows: PayerRetentionCellCounts[] = [],
): PayerRetentionSummary {
  const retentionByWeek = new Map<string, PayerRetentionCellCounts[]>();
  for (const row of retentionRows) {
    const cells = retentionByWeek.get(row.weekStart) ?? [];
    cells.push(row);
    retentionByWeek.set(row.weekStart, cells);
  }
  const cohorts = rows.map((row) => {
    const retention = (retentionByWeek.get(row.weekStart) ?? [])
      .map((cell) => ({
        ...cell,
        initialPayers: row.initialPayers,
        retentionRate: percentage(cell.retainedPayers, row.initialPayers),
      }))
      .sort((left, right) => left.ageWeeks - right.ageWeeks);

    return {
      ...row,
      inactiveToday: Math.max(row.initialPayers - row.activeToday, 0),
      retentionRate: percentage(row.activeToday, row.initialPayers),
      retention,
    };
  });
  const totalPayers = cohorts.reduce(
    (total, cohort) => total + cohort.initialPayers,
    0,
  );
  const activeToday = cohorts.reduce(
    (total, cohort) => total + cohort.activeToday,
    0,
  );

  return {
    cohorts,
    totalPayers,
    activeToday,
    retentionRate: percentage(activeToday, totalPayers),
  };
}
