import { db } from "../lib/db";
import { sql } from "drizzle-orm";
async function run() {
  const res = await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
  console.log(res.map(r => r.table_name).join(', '));
  process.exit(0);
}
run();
