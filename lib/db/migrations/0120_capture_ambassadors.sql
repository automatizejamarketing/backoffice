CREATE TABLE IF NOT EXISTS "ambassadors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"affiliate_id" uuid NOT NULL,
	"category" text NOT NULL,
	"publicity_owner_id" uuid NOT NULL,
	"coproduction_owner_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"workflow" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "ambassadors_affiliate_id_unique" UNIQUE("affiliate_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ambassador_benefits" (
	"ambassador_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"anchor_on" date NOT NULL,
	"expires_on" date NOT NULL,
	"next_credit_on" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ambassador_benefits_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ambassador_credit_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ambassador_id" uuid NOT NULL,
	"cycle_on" date NOT NULL,
	"credits" integer DEFAULT 250 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ambassador_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ambassador_id" uuid NOT NULL,
	"author_email" text NOT NULL,
	"action" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ambassador_members" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"can_grant_starter" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" varchar(100) NOT NULL,
	"name" text,
	"phone" text,
	"capture_source" text,
	"capture_profile" text,
	"revenue_range" text,
	"objective" text,
	"commercial_status" varchar(32) DEFAULT 'novo_lead' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_contacts_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "crm_contacts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_contact_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text,
	"status_from" text,
	"status_to" text,
	"payload" jsonb,
	"author_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ambassadors" ADD CONSTRAINT "ambassadors_affiliate_id_referral_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."referral_affiliates"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ambassadors" ADD CONSTRAINT "ambassadors_publicity_owner_id_backoffice_users_id_fk" FOREIGN KEY ("publicity_owner_id") REFERENCES "public"."backoffice_users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ambassadors" ADD CONSTRAINT "ambassadors_coproduction_owner_id_backoffice_users_id_fk" FOREIGN KEY ("coproduction_owner_id") REFERENCES "public"."backoffice_users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ambassador_benefits" ADD CONSTRAINT "ambassador_benefits_ambassador_id_ambassadors_id_fk" FOREIGN KEY ("ambassador_id") REFERENCES "public"."ambassadors"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ambassador_benefits" ADD CONSTRAINT "ambassador_benefits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ambassador_credit_grants" ADD CONSTRAINT "ambassador_credit_grants_ambassador_id_ambassadors_id_fk" FOREIGN KEY ("ambassador_id") REFERENCES "public"."ambassadors"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ambassador_events" ADD CONSTRAINT "ambassador_events_ambassador_id_ambassadors_id_fk" FOREIGN KEY ("ambassador_id") REFERENCES "public"."ambassadors"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ambassador_members" ADD CONSTRAINT "ambassador_members_user_id_backoffice_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."backoffice_users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "crm_contact_events" ADD CONSTRAINT "crm_contact_events_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ambassador_credit_grants_cycle_unique" ON "ambassador_credit_grants" USING btree ("ambassador_id","cycle_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ambassador_events_ambassador_idx" ON "ambassador_events" USING btree ("ambassador_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_contacts_status_idx" ON "crm_contacts" USING btree ("commercial_status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_contact_events_contact_idx" ON "crm_contact_events" USING btree ("contact_id","created_at");
--> statement-breakpoint
-- Additive backfill: old CRM records remain intact during the rollout.
INSERT INTO crm_contacts (id, user_id, email, name, phone, created_at, commercial_status, status_changed_at, status_changed_by)
SELECT DISTINCT ON (lower(trim(u.email))) u.id, u.id, lower(trim(u.email)), u.name, u.phone,
 u.created_at, coalesce(l.commercial_status, 'novo_lead'), coalesce(l.status_changed_at, u.created_at, now()), l.status_changed_by
FROM users u LEFT JOIN crm_leads l ON l.user_id = u.id
ORDER BY lower(trim(u.email)), u.created_at NULLS LAST, u.id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO crm_contact_events (id, contact_id, kind, body, status_from, status_to, author_email, created_at)
SELECT e.id, c.id, e.kind, e.body, e.status_from, e.status_to, e.author_email, e.created_at
FROM crm_lead_events e JOIN users u ON u.id=e.user_id JOIN crm_contacts c ON c.email=lower(trim(u.email))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_crm_contact_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE existing_contact uuid; incoming_contact uuid; incoming_owner uuid;
BEGIN
  -- Account profile updates keep the canonical contact and never reset its status.
  SELECT id INTO existing_contact FROM crm_contacts WHERE user_id=NEW.id FOR UPDATE;
  IF existing_contact IS NOT NULL THEN
    SELECT id, user_id INTO incoming_contact, incoming_owner FROM crm_contacts WHERE email=lower(trim(NEW.email)) FOR UPDATE;
    IF incoming_contact IS NOT NULL AND incoming_contact <> existing_contact AND incoming_owner IS NULL THEN
      UPDATE crm_contact_events SET contact_id=existing_contact WHERE contact_id=incoming_contact;
      UPDATE crm_contacts c SET
        capture_source=coalesce(other.capture_source,c.capture_source),
        capture_profile=coalesce(other.capture_profile,c.capture_profile),
        revenue_range=coalesce(other.revenue_range,c.revenue_range), objective=coalesce(other.objective,c.objective),
        created_at=least(c.created_at,other.created_at)
      FROM crm_contacts other WHERE c.id=existing_contact AND other.id=incoming_contact;
      DELETE FROM crm_contacts WHERE id=incoming_contact;
      incoming_contact := NULL;
    END IF;
    UPDATE crm_contacts SET
      email=CASE WHEN incoming_contact IS NULL OR incoming_contact=existing_contact THEN lower(trim(NEW.email)) ELSE email END,
      name=coalesce(nullif(trim(name),''),NEW.name), phone=coalesce(nullif(trim(phone),''),NEW.phone), updated_at=now()
    WHERE id=existing_contact;
    RETURN NEW;
  END IF;
  -- A later account attaches to the captured contact without resetting its identity or history.
  INSERT INTO crm_contacts (id, user_id, email, name, phone, created_at)
  VALUES (NEW.id, NEW.id, lower(trim(NEW.email)), NEW.name, NEW.phone, coalesce(NEW.created_at, now()))
  ON CONFLICT (email) DO UPDATE SET
    user_id = coalesce(crm_contacts.user_id, EXCLUDED.user_id),
    name = coalesce(nullif(trim(crm_contacts.name), ''), EXCLUDED.name),
    phone = coalesce(nullif(trim(crm_contacts.phone), ''), EXCLUDED.phone),
    updated_at = now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER users_sync_crm_contact AFTER INSERT OR UPDATE OF email, name, phone ON users
FOR EACH ROW EXECUTE FUNCTION sync_crm_contact_account();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_legacy_crm_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE crm_contacts SET commercial_status=NEW.commercial_status, status_changed_at=NEW.status_changed_at,
    status_changed_by=NEW.status_changed_by, updated_at=now() WHERE user_id=NEW.user_id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER legacy_crm_status_sync AFTER INSERT OR UPDATE ON crm_leads
FOR EACH ROW EXECUTE FUNCTION sync_legacy_crm_status();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_legacy_crm_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO crm_contact_events (id,contact_id,kind,body,status_from,status_to,author_email,created_at)
  SELECT NEW.id,c.id,NEW.kind,NEW.body,NEW.status_from,NEW.status_to,NEW.author_email,NEW.created_at
  FROM crm_contacts c WHERE c.user_id=NEW.user_id ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER legacy_crm_event_sync AFTER INSERT ON crm_lead_events
FOR EACH ROW EXECUTE FUNCTION sync_legacy_crm_event();
