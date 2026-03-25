import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// biome-ignore lint: Forbidden non-null assertion.
// prepare: false avoids postgres-js reusing prepared statements in ways that can
// return stale rows for repeated identical UPDATE shapes (seen with credit bumps).
const client = postgres(process.env.POSTGRES_URL!, { prepare: false });
export const db = drizzle(client);

