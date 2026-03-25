import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { existsSync } from "node:fs";

if (existsSync(".env")) {
  config({ path: ".env" });
}
if (existsSync(".env.local")) {
  config({ path: ".env.local", override: true });
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // biome-ignore lint: Forbidden non-null assertion.
    url: process.env.POSTGRES_URL!,
  },
});
