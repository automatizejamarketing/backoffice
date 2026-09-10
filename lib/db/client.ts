import postgres from "postgres";

// Frontend and backoffice share a Supavisor pool capped at 200 clients.
// Keep each Vercel instance small; excess queries queue in postgres.js.
// Reuse the pool across module reloads instead of opening another set of sockets.
const shared = globalThis as typeof globalThis & {
  automatizePostgresClient?: ReturnType<typeof postgres>;
};

export const postgresClient = (shared.automatizePostgresClient ??= postgres(
  process.env.POSTGRES_URL!,
  {
    max: 3,
    idle_timeout: 5,
    max_lifetime: 60 * 5,
    connect_timeout: 10,
    keep_alive: 60,
    prepare: false,
  },
));
