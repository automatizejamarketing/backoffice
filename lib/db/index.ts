import { drizzle } from "drizzle-orm/postgres-js";
import { postgresClient } from "./client";

export const db = drizzle(postgresClient);
export { postgresClient };
