import postgres from "postgres";

// Frontend and backoffice share a Supavisor pool capped at 200 clients.
// Reuse the pool across module reloads and queue excess work in postgres.js.
const shared = globalThis as typeof globalThis & {
  automatizePostgresClient?: ReturnType<typeof postgres>;
};

// postgres.js supports max_pipeline but omits it from its public Options type.
// Zero means no additional in-flight query on a connection. Even 1 pipelines
// a second query and can hang Supavisor transaction-mode responses indefinitely.
// The pinned postgres patch keeps BEGIN reservation independent of this limit;
// without it max_pipeline: 0 breaks every transaction (postgres issue #1189).
const options = {
  max: 3,
  max_pipeline: 0,
  idle_timeout: 5,
  max_lifetime: 60 * 5,
  connect_timeout: 10,
  keep_alive: 60,
  prepare: false,
};

export const postgresClient = (shared.automatizePostgresClient ??= postgres(
  process.env.POSTGRES_URL!,
  options,
));
