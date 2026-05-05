import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Postgres connection options tuned for Vercel serverless / Supabase
// Supavisor (Transaction Mode) environments. Without explicit options the
// underlying TCP socket can be closed by the server (or load balancer) while
// idle, and the next query attempt fails with EPIPE / "socket has been ended
// by the other party".
//
// - idle_timeout closes our connections proactively (before the server does).
// - max_lifetime recycles long-lived connections.
// - keep_alive enables TCP keep-alive so half-open sockets are detected.
// - max caps concurrent connections (avoid hitting Supavisor limits).
// - prepare: false is required when pooling through PgBouncer / Supavisor
//   in Transaction Mode (port 6543).
// biome-ignore lint: Forbidden non-null assertion.
const client = postgres(process.env.POSTGRES_URL!, {
  idle_timeout: 20,
  max_lifetime: 60 * 30,
  connect_timeout: 10,
  keep_alive: 60,
  max: 10,
  prepare: false,
});
export const db = drizzle(client);
