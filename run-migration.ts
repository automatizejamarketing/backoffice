import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

async function run() {
  console.log("Conectando...");
  const sql = postgres(process.env.POSTGRES_URL!);
  
  try {
    await sql`ALTER TABLE "video_templates" ADD COLUMN "max_duration" integer;`;
    console.log("Coluna adicionada com sucesso!");
  } catch (error) {
    console.error("Erro ao adicionar coluna:", error);
  } finally {
    await sql.end();
    process.exit(0);
  }
}

run();
