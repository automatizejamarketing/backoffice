export function playbookAlertDashboardUrl(
  baseUrl: string,
  search?: string | null,
): string {
  const base = baseUrl.replace(/\/+$/, "");
  const query = search?.trim();
  if (!query) return `${base}/alerts`;
  return `${base}/alerts?${new URLSearchParams({ q: query }).toString()}`;
}

export function buildPlaybookSlackMessage(args: {
  title: string;
  clientLabel: string;
  evidence: string | null | undefined;
  dashboardUrl: string;
}): string {
  return [
    `*Playbook — ${args.title}*`,
    `Cliente: ${args.clientLabel}`,
    args.evidence?.trim() || null,
    `<${args.dashboardUrl}|Abrir dashboard de alertas>`,
  ]
    .filter(Boolean)
    .join("\n");
}
