CREATE TABLE "pricing_cost_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"gas_cents" integer,
	"energy_cents" integer,
	"water_cents" integer,
	"rent_cents" integer,
	"labor_cents" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_cost_settings_gas_cents_nonnegative" CHECK ("pricing_cost_settings"."gas_cents" IS NULL OR "pricing_cost_settings"."gas_cents" >= 0),
	CONSTRAINT "pricing_cost_settings_energy_cents_nonnegative" CHECK ("pricing_cost_settings"."energy_cents" IS NULL OR "pricing_cost_settings"."energy_cents" >= 0),
	CONSTRAINT "pricing_cost_settings_water_cents_nonnegative" CHECK ("pricing_cost_settings"."water_cents" IS NULL OR "pricing_cost_settings"."water_cents" >= 0),
	CONSTRAINT "pricing_cost_settings_rent_cents_nonnegative" CHECK ("pricing_cost_settings"."rent_cents" IS NULL OR "pricing_cost_settings"."rent_cents" >= 0),
	CONSTRAINT "pricing_cost_settings_labor_cents_nonnegative" CHECK ("pricing_cost_settings"."labor_cents" IS NULL OR "pricing_cost_settings"."labor_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pricing_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" varchar(128),
	"price_cents" integer,
	"price_unit" varchar(8),
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_ingredients_price_cents_nonnegative" CHECK ("pricing_ingredients"."price_cents" IS NULL OR "pricing_ingredients"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pricing_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" varchar(128),
	"yield_description" varchar(255),
	"preparation_minutes" integer,
	"sale_price_cents" integer NOT NULL,
	"estimated_cost_cents" integer NOT NULL,
	"packaging_cents" integer,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_recipes_sale_price_cents_positive" CHECK ("pricing_recipes"."sale_price_cents" > 0),
	CONSTRAINT "pricing_recipes_estimated_cost_cents_positive" CHECK ("pricing_recipes"."estimated_cost_cents" > 0),
	CONSTRAINT "pricing_recipes_packaging_cents_nonnegative" CHECK ("pricing_recipes"."packaging_cents" IS NULL OR "pricing_recipes"."packaging_cents" >= 0),
	CONSTRAINT "pricing_recipes_preparation_minutes_nonnegative" CHECK ("pricing_recipes"."preparation_minutes" IS NULL OR "pricing_recipes"."preparation_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pricing_recipe_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"ingredient_id" uuid,
	"name_snapshot" varchar(255) NOT NULL,
	"category_snapshot" varchar(128),
	"quantity" numeric(18, 6) NOT NULL,
	"usage_unit" varchar(8) NOT NULL,
	"price_cents_snapshot" integer,
	"price_unit_snapshot" varchar(8),
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_recipe_lines_position_nonnegative" CHECK ("pricing_recipe_lines"."position" >= 0),
	CONSTRAINT "pricing_recipe_lines_quantity_positive" CHECK ("pricing_recipe_lines"."quantity" > 0),
	CONSTRAINT "pricing_recipe_lines_price_cents_snapshot_nonnegative" CHECK ("pricing_recipe_lines"."price_cents_snapshot" IS NULL OR "pricing_recipe_lines"."price_cents_snapshot" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pricing_recipe_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"body" text NOT NULL,
	"duration_minutes" integer,
	"tip" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_recipe_steps_position_nonnegative" CHECK ("pricing_recipe_steps"."position" >= 0),
	CONSTRAINT "pricing_recipe_steps_duration_minutes_nonnegative" CHECK ("pricing_recipe_steps"."duration_minutes" IS NULL OR "pricing_recipe_steps"."duration_minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pricing_cost_settings" ADD CONSTRAINT "pricing_cost_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pricing_ingredients" ADD CONSTRAINT "pricing_ingredients_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pricing_recipes" ADD CONSTRAINT "pricing_recipes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pricing_recipe_lines" ADD CONSTRAINT "pricing_recipe_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pricing_recipe_lines" ADD CONSTRAINT "pricing_recipe_lines_recipe_id_pricing_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."pricing_recipes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pricing_recipe_lines" ADD CONSTRAINT "pricing_recipe_lines_ingredient_id_pricing_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."pricing_ingredients"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pricing_recipe_steps" ADD CONSTRAINT "pricing_recipe_steps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pricing_recipe_steps" ADD CONSTRAINT "pricing_recipe_steps_recipe_id_pricing_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."pricing_recipes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_cost_settings_company_id_unique" ON "pricing_cost_settings" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "pricing_ingredients_company_id_idx" ON "pricing_ingredients" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "pricing_recipes_company_id_idx" ON "pricing_recipes" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "pricing_recipe_lines_company_id_idx" ON "pricing_recipe_lines" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "pricing_recipe_lines_recipe_id_idx" ON "pricing_recipe_lines" USING btree ("recipe_id");
--> statement-breakpoint
CREATE INDEX "pricing_recipe_steps_company_id_idx" ON "pricing_recipe_steps" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "pricing_recipe_steps_recipe_id_idx" ON "pricing_recipe_steps" USING btree ("recipe_id");
--> statement-breakpoint
