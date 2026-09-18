export function playbookSeverityBadgeClass(severity: string) {
  if (severity === "critical") {
    return "border-transparent bg-red-500/20 text-red-800 dark:bg-red-500/25 dark:text-red-300";
  }
  if (severity === "warning") {
    return "border-transparent bg-amber-500/20 text-amber-900 dark:bg-amber-500/25 dark:text-amber-300";
  }
  return "border-transparent bg-sky-500/20 text-sky-900 dark:bg-sky-500/25 dark:text-sky-300";
}

export function playbookStatusBadgeClass(status: string) {
  switch (status) {
    case "open":
      return "border-transparent bg-violet-500/20 text-violet-800 dark:bg-violet-500/25 dark:text-violet-300";
    case "acknowledged":
      return "border-transparent bg-indigo-500/20 text-indigo-800 dark:bg-indigo-500/25 dark:text-indigo-300";
    case "done":
      return "border-transparent bg-emerald-500/20 text-emerald-800 dark:bg-emerald-500/25 dark:text-emerald-300";
    case "dismissed":
      return "border-transparent bg-zinc-500/20 text-zinc-700 dark:bg-zinc-500/25 dark:text-zinc-300";
    case "resolved":
      return "border-transparent bg-teal-500/20 text-teal-800 dark:bg-teal-500/25 dark:text-teal-300";
    default:
      return "border-transparent bg-muted text-muted-foreground";
  }
}

export function playbookSeverityRowClass(severity: string) {
  if (severity === "critical") {
    return "border-l-2 border-l-red-500 bg-red-500/[0.04] hover:bg-red-500/[0.09] data-[state=selected]:bg-red-500/15";
  }
  if (severity === "warning") {
    return "border-l-2 border-l-amber-500 bg-amber-500/[0.04] hover:bg-amber-500/[0.09] data-[state=selected]:bg-amber-500/15";
  }
  return "border-l-2 border-l-sky-500 bg-sky-500/[0.03] hover:bg-sky-500/[0.08] data-[state=selected]:bg-sky-500/15";
}

export function playbookSeveritySheetClass(severity: string) {
  if (severity === "critical") {
    return "border-red-500/30 bg-red-500/10";
  }
  if (severity === "warning") {
    return "border-amber-500/30 bg-amber-500/10";
  }
  return "border-sky-500/30 bg-sky-500/10";
}
