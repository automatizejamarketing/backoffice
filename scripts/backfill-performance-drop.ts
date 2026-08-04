import { runPerformanceDropBatch } from "@/lib/performance-drop/run-performance-drop-batch";
import { loadAppEnv } from "../lib/env/load-env";

loadAppEnv();

const onlyStale = process.argv.includes("--stale");
const userIds: string[] = [];
for (let i = 0; i < process.argv.length; i += 1) {
  if (process.argv[i] === "--user-id" && process.argv[i + 1]) {
    userIds.push(process.argv[i + 1]);
  }
}

console.log(
  `[performance-drop] starting backfill (${onlyStale ? "stale only" : "all with Meta"}${userIds.length > 0 ? `, users=${userIds.length}` : ""})…`,
);

const result = await runPerformanceDropBatch({
  onlyStale,
  triggeredBy: "script",
  userIds: userIds.length > 0 ? userIds : undefined,
  onProgress: ({ done, total, currentEmail }) => {
    if (!currentEmail) return;
    console.log(`[performance-drop] ${done + 1}/${total} ${currentEmail}`);
  },
});

const drops = result.results.filter((row) => row.hasDrop);
const errors = result.results.filter((row) => row.errorMessage);
const okNoDrop = result.results.filter(
  (row) => !row.hasDrop && !row.errorMessage,
);

console.log("\n=== Summary ===");
console.log(
  JSON.stringify(
    {
      runId: result.runId,
      totalWithMeta: result.totalWithMeta,
      eligible: result.eligible,
      evaluated: result.evaluated,
      dropCount: result.dropCount,
      warningCount: result.warningCount,
      criticalCount: result.criticalCount,
      errorCount: result.errorCount,
      noDropCount: okNoDrop.length,
    },
    null,
    2,
  ),
);

if (drops.length > 0) {
  console.log("\n=== Com queda ===");
  for (const row of drops) {
    console.log(
      `- ${row.email}: ${row.severity} ${row.metric} −${row.dropPercent}% (${row.checkedAccounts} conta(s))`,
    );
  }
}

if (errors.length > 0) {
  console.log("\n=== Erros ===");
  for (const row of errors) {
    console.log(`- ${row.email}: ${row.errorMessage}`);
  }
}

process.exit(result.errorCount > 0 && result.dropCount === 0 ? 1 : 0);
