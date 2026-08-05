import postgres from "postgres";

async function checkDatabases() {
  if (!process.env.POSTGRES_URL) {
    console.error("POSTGRES_URL not set");
    process.exit(1);
  }
  const sql = postgres(process.env.POSTGRES_URL, { max: 1 });
  try {
    console.log("Checking for other databases...");
    const dbs = await sql`SELECT datname FROM pg_database WHERE datistemplate = false;`;
    console.log("Databases:", dbs);
    
    console.log("Checking for other schemas...");
    const schemas = await sql`SELECT schema_name FROM information_schema.schemata;`;
    console.log("Schemas:", schemas);

    console.log("Checking all tables in all schemas...");
    const tables = await sql`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_name = 'backoffice_users';
    `;
    console.log("Tables named 'backoffice_users':", tables);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await sql.end();
  }
}

checkDatabases().catch(console.error);
