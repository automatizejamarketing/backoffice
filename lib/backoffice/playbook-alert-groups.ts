import { isPlaybookPendingStatus } from "./playbook-alert-dashboard";

type GroupableAlert = {
  id: string;
  userId: string;
  severity: string;
  status: string;
};

export type PlaybookAlertGroup<T extends GroupableAlert> = {
  userId: string;
  alerts: T[];
  pendingIds: string[];
  severity: string;
};

export function groupPlaybookAlerts<T extends GroupableAlert>(
  rows: T[],
): PlaybookAlertGroup<T>[] {
  const groups = new Map<string, PlaybookAlertGroup<T>>();
  const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  for (const row of rows) {
    let group = groups.get(row.userId);
    if (!group) {
      group = {
        userId: row.userId,
        alerts: [],
        pendingIds: [],
        severity: row.severity,
      };
      groups.set(row.userId, group);
    }
    group.alerts.push(row);
    if (isPlaybookPendingStatus(row.status)) group.pendingIds.push(row.id);
    if ((rank[row.severity] ?? 3) < (rank[group.severity] ?? 3))
      group.severity = row.severity;
  }
  return [...groups.values()];
}
