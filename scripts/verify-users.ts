import postgres from "postgres";

async function verifyUsers() {
  if (!process.env.POSTGRES_URL) {
    console.error("POSTGRES_URL not set");
    process.exit(1);
  }
  const sql = postgres(process.env.POSTGRES_URL, { max: 1 });
  try {
    console.log("Querying backoffice_users...");
    const users = await sql`SELECT email, role, active FROM backoffice_users`;
    console.log("Current users in database:");
    console.table(users);
    
    const target = users.find(u => u.email === "barretonovaes.vilas@gmail.com");
    if (target) {
      console.log("✅ User FOUND in database:", target);
    } else {
      console.log("❌ User NOT FOUND in database.");
    }
  } catch (error) {
    console.error("Database error:", error);
  } finally {
    await sql.end();
  }
}

verifyUsers().catch(console.error);
