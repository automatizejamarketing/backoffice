import postgres from "postgres";

async function repairBackofficeSchema() {
  const sql = postgres(process.env.POSTGRES_URL!, { max: 1 });

  try {
    console.log("Creating backoffice_users table if not exists...");

    await sql`
      CREATE TABLE IF NOT EXISTS "backoffice_users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "email" varchar(100) NOT NULL,
        "name" varchar(100),
        "role" varchar DEFAULT 'marketing_consultant' NOT NULL,
        "active" boolean DEFAULT true NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      );
    `;

    console.log("Adding unique constraint on email...");
    await sql`
      DO $$ BEGIN
        ALTER TABLE "backoffice_users" ADD CONSTRAINT "backoffice_users_email_unique" UNIQUE("email");
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;

    console.log("Creating user_marketing_consultants table if not exists...");
    await sql`
      CREATE TABLE IF NOT EXISTS "user_marketing_consultants" (
        "user_id" uuid NOT NULL,
        "consultant_id" uuid NOT NULL,
        "assigned_by_email" varchar(100) NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "user_marketing_consultants_user_id_pk" PRIMARY KEY("user_id")
      );
    `;

    console.log("Adding foreign key constraints...");
    await sql`
      DO $$ BEGIN
        ALTER TABLE "user_marketing_consultants" ADD CONSTRAINT "user_marketing_consultants_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;

    await sql`
      DO $$ BEGIN
        ALTER TABLE "user_marketing_consultants" ADD CONSTRAINT "user_marketing_consultants_consultant_id_backoffice_users_id_fk"
          FOREIGN KEY ("consultant_id") REFERENCES "public"."backoffice_users"("id") ON DELETE no action ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;

    console.log("Creating backoffice_magic_links table if not exists...");
    await sql`
      CREATE TABLE IF NOT EXISTS "backoffice_magic_links" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "email" varchar(100) NOT NULL,
        "token_hash" text NOT NULL,
        "expires_at" timestamp NOT NULL,
        "used_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `;

    await sql`
      DO $$ BEGIN
        ALTER TABLE "backoffice_magic_links" ADD CONSTRAINT "backoffice_magic_links_token_hash_unique" UNIQUE("token_hash");
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;

    console.log("Creating index on backoffice_magic_links email...");
    await sql`
      CREATE INDEX IF NOT EXISTS "backoffice_magic_links_email_idx" ON "backoffice_magic_links" ("email");
    `;

    console.log("Backoffice schema repair completed successfully!");
  } catch (error) {
    console.error("Error repairing backoffice schema:", error);
    throw error;
  } finally {
    await sql.end();
  }
}

repairBackofficeSchema().catch(console.error);