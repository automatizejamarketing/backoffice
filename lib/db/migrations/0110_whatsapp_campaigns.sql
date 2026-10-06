CREATE TABLE "whatsapp_campaigns" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "title" varchar(160) NOT NULL,
 "template_name" varchar(255) NOT NULL,
 "body" text NOT NULL,
 "state" varchar(24) DEFAULT 'draft' NOT NULL CHECK (state IN ('draft','scheduled','paused','completed')),
 "dispatch_mode" varchar(16) DEFAULT 'manual' NOT NULL CHECK (dispatch_mode IN ('manual','scheduled')),
 "scheduled_at" timestamp with time zone,
 "unit_cost_micros" integer DEFAULT 0 NOT NULL CHECK (unit_cost_micros >= 0),
 "budget_micros" numeric(16,0) DEFAULT '0' NOT NULL CHECK (budget_micros >= 0),
 "created_by" varchar(100) NOT NULL,
 "updated_by" varchar(100) NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "whatsapp_campaigns_due_idx" ON "whatsapp_campaigns" ("state","scheduled_at");
--> statement-breakpoint
CREATE TABLE "whatsapp_campaign_recipients" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "campaign_id" uuid NOT NULL REFERENCES "whatsapp_campaigns"("id"),
 "user_id" uuid NOT NULL REFERENCES "users"("id"),
 "phone" varchar(16) NOT NULL,
 "state" varchar(24) DEFAULT 'pending' NOT NULL CHECK (state IN ('pending','sending','sent','failed','skipped','unknown','excluded')),
 "reason" text,
 "delivery_id" uuid REFERENCES "whatsapp_template_deliveries"("id"),
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT "whatsapp_campaign_recipients_phone_unique" UNIQUE("campaign_id","phone"),
 CONSTRAINT "whatsapp_campaign_recipients_user_unique" UNIQUE("campaign_id","user_id")
);
--> statement-breakpoint
CREATE INDEX "whatsapp_campaign_recipients_pending_idx" ON "whatsapp_campaign_recipients" ("campaign_id","state");
