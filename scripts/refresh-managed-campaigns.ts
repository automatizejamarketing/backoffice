import { refreshManagedCampaignsBatch } from "@/lib/business/refresh-managed-campaigns-batch";
import { loadAppEnv } from "../lib/env/load-env";

loadAppEnv();

const onlyStale = process.argv.includes("--stale");

console.log(
  `[managed-campaigns] starting refresh (${onlyStale ? "stale only" : "all with Meta"})…`,
);

const result = await refreshManagedCampaignsBatch({
  onlyStale,
  onProgress: ({ done, total, currentEmail }) => {
    if (!currentEmail) return;
    console.log(`[managed-campaigns] ${done + 1}/${total} ${currentEmail}`);
  },
});

const active = result.results.filter((row) => row.hasActiveManagedCampaign);
const inactive = result.results.filter(
  (row) => !row.hasActiveManagedCampaign && !row.errorMessage,
);
const errors = result.results.filter((row) => row.errorMessage);

console.log("\n=== Summary ===");
console.log(
  JSON.stringify(
    {
      totalWithMeta: result.totalWithMeta,
      eligible: result.eligible,
      refreshed: result.refreshed,
      activeCount: result.activeCount,
      inactiveCount: result.inactiveCount,
      errorCount: result.errorCount,
    },
    null,
    2,
  ),
);

if (active.length > 0) {
  console.log("\n=== Campanha ativa ===");
  for (const row of active) {
    console.log(
      `- ${row.email}: ${row.managedCampaignNames.join(" | ") || "(sem nome)"}`,
    );
  }
}

if (inactive.length > 0) {
  console.log(`\n=== Sem campanha ativa (${inactive.length}) ===`);
  for (const row of inactive.slice(0, 50)) {
    console.log(`- ${row.email}`);
  }
  if (inactive.length > 50) {
    console.log(`… e mais ${inactive.length - 50}`);
  }
}

if (errors.length > 0) {
  console.log("\n=== Erros ===");
  for (const row of errors) {
    console.log(`- ${row.email}: ${row.errorMessage}`);
  }
}

process.exit(result.errorCount > 0 && result.activeCount === 0 ? 1 : 0);
