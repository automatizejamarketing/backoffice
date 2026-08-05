import postgres from "postgres";

async function checkTemplate() {
  if (!process.env.POSTGRES_URL) {
    console.error("POSTGRES_URL not set");
    process.exit(1);
  }
  const sql = postgres(process.env.POSTGRES_URL, { max: 1 });
  try {
    const [template] = await sql`
      SELECT id, name, thumbnail_url, video_preview_url, status, creatomate_template_id
      FROM video_templates
      WHERE name = 'template 01'
    `;
    console.log("Template:", template);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await sql.end();
  }
}

checkTemplate().catch(console.error);
