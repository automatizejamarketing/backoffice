-- ==== 0057_food_service_foundation ====
-- Fundação operacional de cardápio, pedidos, fichas técnicas e estoque.
-- A migração é somente aditiva. Movimentações de estoque e eventos de pedido
-- formam ledgers imutáveis; correções devem ser registradas por compensação.

CREATE TABLE IF NOT EXISTS "food_service_settings" (
  "location_id" uuid PRIMARY KEY REFERENCES "company_locations"("id") ON DELETE CASCADE,
  "acceptance_mode" varchar NOT NULL DEFAULT 'automatic',
  "allow_negative_stock" boolean NOT NULL DEFAULT false,
  "payment_reservation_minutes" integer NOT NULL DEFAULT 15,
  "default_preparation_minutes" integer NOT NULL DEFAULT 30,
  "pickup_enabled" boolean NOT NULL DEFAULT true,
  "delivery_enabled" boolean NOT NULL DEFAULT false,
  "counter_enabled" boolean NOT NULL DEFAULT false,
  "table_enabled" boolean NOT NULL DEFAULT false,
  "minimum_order_centavos" integer NOT NULL DEFAULT 0,
  "delivery_fee_centavos" integer NOT NULL DEFAULT 0,
  "delivery_areas" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_settings_acceptance_mode_check" CHECK ("acceptance_mode" IN ('automatic', 'manual')),
  CONSTRAINT "food_service_settings_reservation_minutes_check" CHECK ("payment_reservation_minutes" BETWEEN 1 AND 1440),
  CONSTRAINT "food_service_settings_preparation_minutes_check" CHECK ("default_preparation_minutes" BETWEEN 1 AND 1440),
  CONSTRAINT "food_service_settings_commercial_amounts_check" CHECK ("minimum_order_centavos" >= 0 AND "delivery_fee_centavos" >= 0),
  CONSTRAINT "food_service_settings_lot_tracking_check" CHECK ("allow_negative_stock" = false)
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_menus" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "slug" varchar(120) NOT NULL,
  "name" varchar(160) NOT NULL,
  "description" text,
  "logo_url" text,
  "brand_color" varchar(16),
  "active" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_menus_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_menus_slug_unique" ON "food_service_menus"("slug");
CREATE INDEX IF NOT EXISTS "food_service_menus_company_id_idx" ON "food_service_menus"("company_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "menu_id" uuid NOT NULL REFERENCES "food_service_menus"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "description" text,
  "position" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_categories_menu_position_idx" ON "food_service_categories"("menu_id", "position");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "category_id" uuid NOT NULL REFERENCES "food_service_categories"("id") ON DELETE CASCADE,
  "name" varchar(160) NOT NULL,
  "description" text,
  "image_url" text,
  "base_price_centavos" integer NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "featured" boolean NOT NULL DEFAULT false,
  "preparation_minutes" integer,
  "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_items_price_check" CHECK ("base_price_centavos" >= 0),
  CONSTRAINT "food_service_items_preparation_check" CHECK ("preparation_minutes" IS NULL OR "preparation_minutes" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_items_category_position_idx" ON "food_service_items"("category_id", "position");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_option_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "min_selections" integer NOT NULL DEFAULT 0,
  "max_selections" integer NOT NULL DEFAULT 1,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_option_groups_selection_check" CHECK ("min_selections" >= 0 AND "max_selections" >= "min_selections")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_option_groups_company_id_idx" ON "food_service_option_groups"("company_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_options" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "group_id" uuid NOT NULL REFERENCES "food_service_option_groups"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "description" text,
  "price_delta_centavos" integer NOT NULL DEFAULT 0,
  "position" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_options_group_position_idx" ON "food_service_options"("group_id", "position");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_item_option_groups" (
  "item_id" uuid NOT NULL REFERENCES "food_service_items"("id") ON DELETE CASCADE,
  "group_id" uuid NOT NULL REFERENCES "food_service_option_groups"("id") ON DELETE CASCADE,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("item_id", "group_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_item_option_groups_item_position_idx" ON "food_service_item_option_groups"("item_id", "position");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_unit_item_overrides" (
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "food_service_items"("id") ON DELETE CASCADE,
  "price_centavos" integer,
  "active" boolean,
  "manually_available" boolean,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("location_id", "item_id"),
  CONSTRAINT "food_service_unit_item_overrides_price_check" CHECK ("price_centavos" IS NULL OR "price_centavos" >= 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_unit_item_overrides_item_id_idx" ON "food_service_unit_item_overrides"("item_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_ingredients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" varchar(160) NOT NULL,
  "base_unit" varchar NOT NULL,
  "sku" varchar(80),
  "minimum_quantity_micros" numeric(24,0) NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_ingredients_base_unit_check" CHECK ("base_unit" IN ('g', 'ml', 'unit')),
  CONSTRAINT "food_service_ingredients_minimum_check" CHECK ("minimum_quantity_micros" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_ingredients_company_name_unique" ON "food_service_ingredients"("company_id", "name");
CREATE INDEX IF NOT EXISTS "food_service_ingredients_company_id_idx" ON "food_service_ingredients"("company_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_recipe_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_id" uuid REFERENCES "food_service_items"("id") ON DELETE CASCADE,
  "option_id" uuid REFERENCES "food_service_options"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "yield_quantity_micros" numeric(24,0) NOT NULL DEFAULT 1000000,
  "active" boolean NOT NULL DEFAULT true,
  "valid_from" timestamp NOT NULL DEFAULT now(),
  "valid_to" timestamp,
  "created_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_recipe_versions_target_check" CHECK (("item_id" IS NOT NULL AND "option_id" IS NULL) OR ("item_id" IS NULL AND "option_id" IS NOT NULL)),
  CONSTRAINT "food_service_recipe_versions_version_check" CHECK ("version" > 0 AND "yield_quantity_micros" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_recipe_versions_item_id_idx" ON "food_service_recipe_versions"("item_id");
CREATE INDEX IF NOT EXISTS "food_service_recipe_versions_option_id_idx" ON "food_service_recipe_versions"("option_id");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_recipe_versions_item_version_unique" ON "food_service_recipe_versions"("item_id", "version") WHERE "item_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_recipe_versions_option_version_unique" ON "food_service_recipe_versions"("option_id", "version") WHERE "option_id" IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_recipe_components" (
  "recipe_version_id" uuid NOT NULL REFERENCES "food_service_recipe_versions"("id") ON DELETE CASCADE,
  "ingredient_id" uuid NOT NULL REFERENCES "food_service_ingredients"("id"),
  "quantity_micros" numeric(24,0) NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("recipe_version_id", "ingredient_id"),
  CONSTRAINT "food_service_recipe_components_quantity_check" CHECK ("quantity_micros" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_recipe_components_ingredient_id_idx" ON "food_service_recipe_components"("ingredient_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_carts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id"),
  "channel" varchar NOT NULL,
  "fulfillment_type" varchar NOT NULL,
  "status" varchar NOT NULL DEFAULT 'active',
  "customer_token_hash" text,
  "revision" integer NOT NULL DEFAULT 0,
  "scheduled_for" timestamp,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_carts_channel_check" CHECK ("channel" IN ('web', 'whatsapp', 'operator', 'integration')),
  CONSTRAINT "food_service_carts_fulfillment_check" CHECK ("fulfillment_type" IN ('delivery', 'pickup', 'counter', 'table')),
  CONSTRAINT "food_service_carts_status_check" CHECK ("status" IN ('active', 'converted', 'abandoned', 'expired')),
  CONSTRAINT "food_service_carts_revision_check" CHECK ("revision" >= 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_carts_location_status_idx" ON "food_service_carts"("location_id", "status", "updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_carts_location_customer_token_unique" ON "food_service_carts"("location_id", "customer_token_hash");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_cart_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cart_id" uuid NOT NULL REFERENCES "food_service_carts"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "food_service_items"("id"),
  "quantity" integer NOT NULL,
  "selected_options" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_cart_items_quantity_check" CHECK ("quantity" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_cart_items_cart_id_idx" ON "food_service_cart_items"("cart_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "display_number" bigserial NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id"),
  "menu_id" uuid NOT NULL REFERENCES "food_service_menus"("id"),
  "cart_id" uuid REFERENCES "food_service_carts"("id"),
  "idempotency_key" varchar(160) NOT NULL,
  "status" varchar(24) NOT NULL,
  "payment_status" varchar(24) NOT NULL DEFAULT 'not_required',
  "fulfillment_type" varchar NOT NULL,
  "channel" varchar(24) NOT NULL,
  "customer_name" varchar(160) NOT NULL,
  "customer_phone" varchar(24) NOT NULL,
  "customer_email" varchar(160),
  "fulfillment_details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "notes" text,
  "scheduled_for" timestamp,
  "reservation_expires_at" timestamp,
  "subtotal_centavos" integer NOT NULL,
  "discount_centavos" integer NOT NULL DEFAULT 0,
  "delivery_fee_centavos" integer NOT NULL DEFAULT 0,
  "total_centavos" integer NOT NULL,
  "theoretical_cmv_centavos" integer,
  "realized_cmv_centavos" integer,
  "cost_completeness" varchar NOT NULL DEFAULT 'missing_recipe',
  "accepted_at" timestamp,
  "preparation_started_at" timestamp,
  "ready_at" timestamp,
  "dispatched_at" timestamp,
  "completed_at" timestamp,
  "rejected_at" timestamp,
  "expired_at" timestamp,
  "cancelled_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_orders_status_check" CHECK ("status" IN ('received','accepted','preparing','ready','dispatched','completed','rejected','cancelled','expired')),
  CONSTRAINT "food_service_orders_payment_status_check" CHECK ("payment_status" IN ('not_required','pending','approved','failed','refunded')),
  CONSTRAINT "food_service_orders_fulfillment_check" CHECK ("fulfillment_type" IN ('delivery','pickup','counter','table')),
  CONSTRAINT "food_service_orders_channel_check" CHECK ("channel" IN ('web','whatsapp','operator','integration')),
  CONSTRAINT "food_service_orders_amount_check" CHECK ("subtotal_centavos" >= 0 AND "discount_centavos" >= 0 AND "discount_centavos" <= "subtotal_centavos" AND "delivery_fee_centavos" >= 0 AND "total_centavos" = "subtotal_centavos" - "discount_centavos" + "delivery_fee_centavos"),
  CONSTRAINT "food_service_orders_cost_completeness_check" CHECK ("cost_completeness" IN ('complete', 'missing_recipe', 'missing_cost'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_orders_location_idempotency_unique" ON "food_service_orders"("location_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_orders_display_number_unique" ON "food_service_orders"("display_number");
CREATE INDEX IF NOT EXISTS "food_service_orders_location_status_idx" ON "food_service_orders"("location_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "food_service_orders_company_created_idx" ON "food_service_orders"("company_id", "created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "food_service_orders"("id"),
  "item_id" uuid REFERENCES "food_service_items"("id") ON DELETE SET NULL,
  "item_name_snapshot" varchar(160) NOT NULL,
  "category_name_snapshot" varchar(120) NOT NULL,
  "unit_price_centavos" integer NOT NULL,
  "quantity" integer NOT NULL,
  "selected_options" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "recipe_snapshot" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "theoretical_cmv_centavos" integer,
  "cost_completeness" varchar NOT NULL DEFAULT 'missing_recipe',
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_order_items_quantity_price_check" CHECK ("quantity" > 0 AND "unit_price_centavos" >= 0),
  CONSTRAINT "food_service_order_items_cost_completeness_check" CHECK ("cost_completeness" IN ('complete', 'missing_recipe', 'missing_cost'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_order_items_order_id_idx" ON "food_service_order_items"("order_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_order_events" (
  "id" bigserial PRIMARY KEY,
  "order_id" uuid NOT NULL REFERENCES "food_service_orders"("id"),
  "type" varchar(48) NOT NULL,
  "from_status" varchar(24),
  "to_status" varchar(24),
  "source" varchar NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id"),
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_order_events_source_check" CHECK ("source" IN ('web','whatsapp','operator','integration','system'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_order_events_order_id_idx" ON "food_service_order_events"("order_id", "id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "food_service_orders"("id"),
  "provider" varchar NOT NULL,
  "method" varchar NOT NULL,
  "status" varchar(24) NOT NULL,
  "provider_payment_id" text,
  "provider_preference_id" text,
  "amount_centavos" integer NOT NULL,
  "fee_centavos" integer,
  "automatize_commission_centavos" integer,
  "raw_status" text,
  "approved_at" timestamp,
  "refunded_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_payments_provider_check" CHECK ("provider" IN ('external','mercadopago')),
  CONSTRAINT "food_service_payments_method_check" CHECK ("method" IN ('pix','credit_card','debit_card','cash','other')),
  CONSTRAINT "food_service_payments_status_check" CHECK ("status" IN ('not_required','pending','approved','failed','refunded')),
  CONSTRAINT "food_service_payments_amount_check" CHECK ("amount_centavos" >= 0 AND ("fee_centavos" IS NULL OR "fee_centavos" >= 0) AND ("automatize_commission_centavos" IS NULL OR "automatize_commission_centavos" >= 0) AND COALESCE("fee_centavos", 0) + COALESCE("automatize_commission_centavos", 0) <= "amount_centavos")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_payments_order_id_idx" ON "food_service_payments"("order_id");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_payments_provider_payment_unique" ON "food_service_payments"("provider", "provider_payment_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_suppliers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "name" varchar(160) NOT NULL,
  "legal_name" varchar(200),
  "cnpj" varchar(14),
  "phone" varchar(24),
  "email" varchar(160),
  "notes" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_suppliers_cnpj_check" CHECK ("cnpj" IS NULL OR "cnpj" ~ '^[0-9]{14}$')
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_suppliers_company_name_unique" ON "food_service_suppliers"("company_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_suppliers_company_cnpj_unique" ON "food_service_suppliers"("company_id", "cnpj") WHERE "cnpj" IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_purchase_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "display_number" bigserial NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id"),
  "supplier_id" uuid NOT NULL REFERENCES "food_service_suppliers"("id"),
  "status" varchar NOT NULL DEFAULT 'draft',
  "expected_on" date,
  "notes" text,
  "idempotency_key" varchar(160) NOT NULL,
  "input_fingerprint" text NOT NULL,
  "close_reason" text,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "placed_at" timestamp,
  "closed_at" timestamp,
  "cancelled_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_purchase_orders_status_check" CHECK ("status" IN ('draft','placed','partially_received','received','closed','cancelled'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_purchase_orders_display_number_unique" ON "food_service_purchase_orders"("display_number");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_purchase_orders_location_idempotency_unique" ON "food_service_purchase_orders"("location_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "food_service_purchase_orders_location_status_idx" ON "food_service_purchase_orders"("location_id", "status", "created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_purchase_order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "purchase_order_id" uuid NOT NULL REFERENCES "food_service_purchase_orders"("id"),
  "ingredient_id" uuid NOT NULL REFERENCES "food_service_ingredients"("id"),
  "ingredient_name_snapshot" varchar(160) NOT NULL,
  "purchase_unit_label" varchar(80) NOT NULL,
  "ordered_purchase_units_micros" numeric(24,0) NOT NULL,
  "conversion_factor_micros" numeric(24,0) NOT NULL,
  "ordered_base_quantity_micros" numeric(24,0) NOT NULL,
  "expected_unit_cost_microcentavos" numeric(30,0) NOT NULL,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_purchase_order_lines_values_check" CHECK ("ordered_purchase_units_micros" > 0 AND "conversion_factor_micros" > 0 AND "ordered_base_quantity_micros" > 0 AND "expected_unit_cost_microcentavos" >= 0),
  CONSTRAINT "food_service_purchase_order_lines_conversion_check" CHECK ("ordered_base_quantity_micros" = ("ordered_purchase_units_micros" * "conversion_factor_micros") / 1000000)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_purchase_order_lines_order_ingredient_unique" ON "food_service_purchase_order_lines"("purchase_order_id", "ingredient_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_goods_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "purchase_order_id" uuid NOT NULL REFERENCES "food_service_purchase_orders"("id"),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id"),
  "supplier_id" uuid NOT NULL REFERENCES "food_service_suppliers"("id"),
  "status" varchar NOT NULL DEFAULT 'posted',
  "document_number" varchar(120),
  "received_at" timestamp NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "input_fingerprint" text NOT NULL,
  "notes" text,
  "posted_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_goods_receipts_status_check" CHECK ("status" IN ('posted','cancelled'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_goods_receipts_order_idempotency_unique" ON "food_service_goods_receipts"("purchase_order_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_goods_receipts_supplier_document_unique" ON "food_service_goods_receipts"("company_id", "supplier_id", "document_number") WHERE "document_number" IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_purchase_order_events" (
  "id" bigserial PRIMARY KEY,
  "purchase_order_id" uuid NOT NULL REFERENCES "food_service_purchase_orders"("id"),
  "type" varchar(48) NOT NULL,
  "from_status" varchar(32),
  "to_status" varchar(32),
  "source" varchar NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id"),
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_purchase_order_events_source_check" CHECK ("source" IN ('web','whatsapp','operator','integration','system'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_purchase_order_events_order_id_idx" ON "food_service_purchase_order_events"("purchase_order_id", "id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_stock_positions" (
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id") ON DELETE CASCADE,
  "ingredient_id" uuid NOT NULL REFERENCES "food_service_ingredients"("id") ON DELETE CASCADE,
  "physical_quantity_micros" numeric(24,0) NOT NULL DEFAULT 0,
  "reserved_quantity_micros" numeric(24,0) NOT NULL DEFAULT 0,
  "average_cost_microcentavos" numeric(30,0) NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("location_id", "ingredient_id"),
  CONSTRAINT "food_service_stock_positions_reserved_check" CHECK ("physical_quantity_micros" >= 0 AND "reserved_quantity_micros" >= 0 AND "reserved_quantity_micros" <= "physical_quantity_micros"),
  CONSTRAINT "food_service_stock_positions_cost_check" CHECK ("average_cost_microcentavos" >= 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_stock_positions_ingredient_id_idx" ON "food_service_stock_positions"("ingredient_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_stock_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id"),
  "ingredient_id" uuid NOT NULL REFERENCES "food_service_ingredients"("id"),
  "order_id" uuid REFERENCES "food_service_orders"("id"),
  "kind" varchar NOT NULL,
  "physical_delta_micros" numeric(24,0) NOT NULL DEFAULT 0,
  "reserved_delta_micros" numeric(24,0) NOT NULL DEFAULT 0,
  "unit_cost_microcentavos" numeric(30,0),
  "total_cost_centavos" integer,
  "classification" varchar,
  "classified_quantity_micros" numeric(24, 0) NOT NULL DEFAULT 0,
  "reclassifies_movement_id" uuid REFERENCES "food_service_stock_movements"("id"),
  "lot_code" varchar(120),
  "expires_at" timestamp,
  "reason" text,
  "source" varchar NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id"),
  "idempotency_key" varchar(160) NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_stock_movements_kind_check" CHECK ("kind" IN ('entry','reserve','release','consume','loss','correction')),
  CONSTRAINT "food_service_stock_movements_source_check" CHECK ("source" IN ('web','whatsapp','operator','integration','system')),
  CONSTRAINT "food_service_stock_movements_cost_check" CHECK (("unit_cost_microcentavos" IS NULL OR "unit_cost_microcentavos" >= 0) AND ("total_cost_centavos" IS NULL OR "total_cost_centavos" >= 0)),
  CONSTRAINT "food_service_stock_movements_classification_check" CHECK ("classification" IS NULL OR "classification" IN ('sale_cmv', 'waste')),
  CONSTRAINT "food_service_stock_movements_classified_quantity_check" CHECK ("classified_quantity_micros" >= 0),
  CONSTRAINT "food_service_stock_movements_classification_values_check" CHECK (("classification" IS NULL AND "classified_quantity_micros" = 0 AND "total_cost_centavos" IS NULL) OR ("classification" IS NOT NULL AND "classified_quantity_micros" > 0 AND "total_cost_centavos" IS NOT NULL)),
  CONSTRAINT "food_service_stock_movements_shape_check" CHECK (("kind" = 'entry' AND "physical_delta_micros" > 0 AND "reserved_delta_micros" = 0 AND "unit_cost_microcentavos" IS NOT NULL AND "reclassifies_movement_id" IS NULL) OR ("kind" = 'reserve' AND "physical_delta_micros" = 0 AND "reserved_delta_micros" > 0 AND "reclassifies_movement_id" IS NULL) OR ("kind" = 'release' AND "physical_delta_micros" = 0 AND "reserved_delta_micros" < 0 AND "reclassifies_movement_id" IS NULL) OR ("kind" = 'consume' AND "physical_delta_micros" < 0 AND "reserved_delta_micros" = "physical_delta_micros" AND "classification" = 'sale_cmv' AND "classified_quantity_micros" = -"physical_delta_micros" AND "reclassifies_movement_id" IS NULL) OR ("kind" = 'loss' AND "reserved_delta_micros" = 0 AND "classification" = 'waste' AND (("physical_delta_micros" < 0 AND "classified_quantity_micros" = -"physical_delta_micros" AND "reclassifies_movement_id" IS NULL) OR ("physical_delta_micros" = 0 AND "reclassifies_movement_id" IS NOT NULL))) OR ("kind" = 'correction' AND "physical_delta_micros" <> 0 AND "reserved_delta_micros" = 0 AND "reclassifies_movement_id" IS NULL)),
  CONSTRAINT "food_service_stock_movements_lot_check" CHECK (("lot_code" IS NULL AND "expires_at" IS NULL) OR "kind" = 'entry')
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_stock_movements_location_idempotency_unique" ON "food_service_stock_movements"("location_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "food_service_stock_movements_location_ingredient_created_idx" ON "food_service_stock_movements"("location_id", "ingredient_id", "created_at");
CREATE INDEX IF NOT EXISTS "food_service_stock_movements_order_id_idx" ON "food_service_stock_movements"("order_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_goods_receipt_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "receipt_id" uuid NOT NULL REFERENCES "food_service_goods_receipts"("id"),
  "purchase_order_line_id" uuid NOT NULL REFERENCES "food_service_purchase_order_lines"("id"),
  "ingredient_id" uuid NOT NULL REFERENCES "food_service_ingredients"("id"),
  "accepted_base_quantity_micros" numeric(24,0) NOT NULL DEFAULT 0,
  "rejected_base_quantity_micros" numeric(24,0) NOT NULL DEFAULT 0,
  "actual_unit_cost_microcentavos" numeric(30,0),
  "rejection_reason" text,
  "lot_code" varchar(120),
  "expires_on" date,
  "stock_movement_id" uuid REFERENCES "food_service_stock_movements"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_goods_receipt_lines_quantities_check" CHECK ("accepted_base_quantity_micros" >= 0 AND "rejected_base_quantity_micros" >= 0 AND ("accepted_base_quantity_micros" > 0 OR "rejected_base_quantity_micros" > 0)),
  CONSTRAINT "food_service_goods_receipt_lines_posting_check" CHECK (("accepted_base_quantity_micros" > 0 AND "actual_unit_cost_microcentavos" IS NOT NULL AND "actual_unit_cost_microcentavos" >= 0 AND "stock_movement_id" IS NOT NULL) OR ("accepted_base_quantity_micros" = 0 AND "actual_unit_cost_microcentavos" IS NULL AND "stock_movement_id" IS NULL)),
  CONSTRAINT "food_service_goods_receipt_lines_rejection_check" CHECK ("rejected_base_quantity_micros" = 0 OR LENGTH(TRIM(COALESCE("rejection_reason", ''))) >= 3)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_goods_receipt_lines_movement_unique" ON "food_service_goods_receipt_lines"("stock_movement_id");
CREATE INDEX IF NOT EXISTS "food_service_goods_receipt_lines_receipt_id_idx" ON "food_service_goods_receipt_lines"("receipt_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_stock_lots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id"),
  "ingredient_id" uuid NOT NULL REFERENCES "food_service_ingredients"("id"),
  "source_movement_id" uuid NOT NULL REFERENCES "food_service_stock_movements"("id"),
  "lot_code" varchar(120),
  "expires_on" date,
  "received_at" timestamp NOT NULL DEFAULT now(),
  "physical_quantity_micros" numeric(24,0) NOT NULL,
  "reserved_quantity_micros" numeric(24,0) NOT NULL DEFAULT 0,
  "cost_status" varchar NOT NULL DEFAULT 'known',
  "unit_cost_microcentavos" numeric(30,0),
  "status" varchar NOT NULL DEFAULT 'active',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_stock_lots_quantities_check" CHECK ("physical_quantity_micros" >= 0 AND "reserved_quantity_micros" >= 0 AND "reserved_quantity_micros" <= "physical_quantity_micros"),
  CONSTRAINT "food_service_stock_lots_cost_check" CHECK (("cost_status" = 'known' AND "unit_cost_microcentavos" IS NOT NULL AND "unit_cost_microcentavos" >= 0) OR ("cost_status" = 'missing' AND "unit_cost_microcentavos" IS NULL)),
  CONSTRAINT "food_service_stock_lots_status_check" CHECK (("status" = 'depleted' AND "physical_quantity_micros" = 0 AND "reserved_quantity_micros" = 0) OR ("status" IN ('active','quarantined') AND "physical_quantity_micros" > 0))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_stock_lots_source_movement_unique" ON "food_service_stock_lots"("source_movement_id");
CREATE INDEX IF NOT EXISTS "food_service_stock_lots_fefo_idx" ON "food_service_stock_lots"("location_id", "ingredient_id", "status", "expires_on", "received_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_stock_movement_lots" (
  "movement_id" uuid NOT NULL REFERENCES "food_service_stock_movements"("id"),
  "stock_lot_id" uuid NOT NULL REFERENCES "food_service_stock_lots"("id"),
  "physical_delta_micros" numeric(24,0) NOT NULL DEFAULT 0,
  "reserved_delta_micros" numeric(24,0) NOT NULL DEFAULT 0,
  "unit_cost_microcentavos" numeric(30,0) NOT NULL,
  "total_cost_centavos" integer NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("movement_id", "stock_lot_id"),
  CONSTRAINT "food_service_stock_movement_lots_values_check" CHECK (("physical_delta_micros" <> 0 OR "reserved_delta_micros" <> 0) AND "unit_cost_microcentavos" >= 0 AND "total_cost_centavos" >= 0 AND "total_cost_centavos" = FLOOR((GREATEST(ABS("physical_delta_micros"), ABS("reserved_delta_micros")) * "unit_cost_microcentavos") / 1000000000000))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_stock_movement_lots_lot_id_idx" ON "food_service_stock_movement_lots"("stock_lot_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_order_stock_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "food_service_orders"("id"),
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id"),
  "ingredient_id" uuid NOT NULL REFERENCES "food_service_ingredients"("id"),
  "quantity_micros" numeric(24,0) NOT NULL,
  "unit_cost_microcentavos" numeric(30,0) NOT NULL,
  "status" varchar NOT NULL DEFAULT 'reserved',
  "consumed_at" timestamp,
  "released_at" timestamp,
  "lost_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_order_stock_reservations_status_check" CHECK ("status" IN ('reserved','consumed','released','lost')),
  CONSTRAINT "food_service_order_stock_reservations_quantity_cost_check" CHECK ("quantity_micros" > 0 AND "unit_cost_microcentavos" >= 0),
  CONSTRAINT "food_service_order_stock_reservations_lifecycle_check" CHECK (("status" = 'reserved' AND "consumed_at" IS NULL AND "released_at" IS NULL AND "lost_at" IS NULL) OR ("status" = 'consumed' AND "consumed_at" IS NOT NULL AND "released_at" IS NULL AND "lost_at" IS NULL) OR ("status" = 'released' AND "consumed_at" IS NULL AND "released_at" IS NOT NULL AND "lost_at" IS NULL) OR ("status" = 'lost' AND "consumed_at" IS NOT NULL AND "released_at" IS NULL AND "lost_at" IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_order_stock_reservations_order_ingredient_unique" ON "food_service_order_stock_reservations"("order_id", "ingredient_id");
CREATE INDEX IF NOT EXISTS "food_service_order_stock_reservations_location_status_idx" ON "food_service_order_stock_reservations"("location_id", "status");

CREATE TABLE IF NOT EXISTS "food_service_order_stock_allocations" (
  "reservation_id" uuid NOT NULL REFERENCES "food_service_order_stock_reservations"("id"),
  "stock_lot_id" uuid NOT NULL REFERENCES "food_service_stock_lots"("id"),
  "quantity_micros" numeric(24,0) NOT NULL,
  "unit_cost_microcentavos" numeric(30,0) NOT NULL,
  "status" varchar NOT NULL DEFAULT 'reserved',
  "consumed_at" timestamp,
  "released_at" timestamp,
  "lost_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("reservation_id", "stock_lot_id"),
  CONSTRAINT "food_service_order_stock_allocations_values_check" CHECK ("quantity_micros" > 0 AND "unit_cost_microcentavos" >= 0),
  CONSTRAINT "food_service_order_stock_allocations_status_check" CHECK ("status" IN ('reserved','consumed','released','lost')),
  CONSTRAINT "food_service_order_stock_allocations_lifecycle_check" CHECK (("status" = 'reserved' AND "consumed_at" IS NULL AND "released_at" IS NULL AND "lost_at" IS NULL) OR ("status" = 'consumed' AND "consumed_at" IS NOT NULL AND "released_at" IS NULL AND "lost_at" IS NULL) OR ("status" = 'released' AND "consumed_at" IS NULL AND "released_at" IS NOT NULL AND "lost_at" IS NULL) OR ("status" = 'lost' AND "consumed_at" IS NOT NULL AND "released_at" IS NULL AND "lost_at" IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_order_stock_allocations_lot_status_idx" ON "food_service_order_stock_allocations"("stock_lot_id", "status");


CREATE TABLE IF NOT EXISTS "food_service_inventory_counts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id"),
  "status" varchar NOT NULL DEFAULT 'completed',
  "idempotency_key" varchar(160) NOT NULL,
  "input_fingerprint" text NOT NULL,
  "notes" text,
  "counted_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "counted_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_inventory_counts_status_check" CHECK ("status" IN ('completed', 'cancelled'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_inventory_counts_location_idempotency_unique" ON "food_service_inventory_counts"("location_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "food_service_inventory_counts_location_counted_idx" ON "food_service_inventory_counts"("location_id", "counted_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_inventory_count_lines" (
  "count_id" uuid NOT NULL REFERENCES "food_service_inventory_counts"("id"),
  "ingredient_id" uuid NOT NULL REFERENCES "food_service_ingredients"("id"),
  "expected_physical_micros" numeric(24,0) NOT NULL,
  "counted_physical_micros" numeric(24,0) NOT NULL,
  "variance_micros" numeric(24,0) NOT NULL,
  "movement_id" uuid REFERENCES "food_service_stock_movements"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("count_id", "ingredient_id"),
  CONSTRAINT "food_service_inventory_count_lines_counted_check" CHECK ("counted_physical_micros" >= 0),
  CONSTRAINT "food_service_inventory_count_lines_variance_check" CHECK ("variance_micros" = "counted_physical_micros" - "expected_physical_micros" AND (("variance_micros" = 0 AND "movement_id" IS NULL) OR ("variance_micros" <> 0 AND "movement_id" IS NOT NULL)))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_inventory_count_lines_ingredient_id_idx" ON "food_service_inventory_count_lines"("ingredient_id");

CREATE OR REPLACE FUNCTION validate_food_service_movement_lot_allocation_id(p_movement_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  parent_record record;
BEGIN
  SELECT
    m.company_id,
    m.location_id,
    m.ingredient_id,
    m.physical_delta_micros,
    m.reserved_delta_micros,
    m.total_cost_centavos,
    COALESCE(SUM(a.physical_delta_micros), 0) AS allocated_physical,
    COALESCE(SUM(a.reserved_delta_micros), 0) AS allocated_reserved,
    FLOOR(COALESCE(SUM(
      GREATEST(ABS(a.physical_delta_micros), ABS(a.reserved_delta_micros)) *
      a.unit_cost_microcentavos
    ), 0) / 1000000000000) AS allocated_cost_centavos,
    COUNT(a.stock_lot_id) AS allocation_count,
    COALESCE(BOOL_AND(
      l.company_id = m.company_id AND
      l.location_id = m.location_id AND
      l.ingredient_id = m.ingredient_id
    ), true) AS same_scope,
    cl.company_id = m.company_id AS location_scope,
    i.company_id = m.company_id AS ingredient_scope,
    m.order_id IS NULL OR (
      o.company_id = m.company_id AND o.location_id = m.location_id
    ) AS order_scope,
    COALESCE(BOOL_AND(a.unit_cost_microcentavos = l.unit_cost_microcentavos), true)
      AS allocation_cost_scope,
    m.reclassifies_movement_id IS NULL OR (
      original.kind = 'consume' AND
      original.company_id = m.company_id AND
      original.location_id = m.location_id AND
      original.ingredient_id = m.ingredient_id AND
      original.order_id IS NOT DISTINCT FROM m.order_id AND
      original.classified_quantity_micros = m.classified_quantity_micros AND
      original.total_cost_centavos = m.total_cost_centavos
    ) AS reclassification_scope
  INTO parent_record
  FROM food_service_stock_movements m
  JOIN company_locations cl ON cl.id = m.location_id
  JOIN food_service_ingredients i ON i.id = m.ingredient_id
  LEFT JOIN food_service_orders o ON o.id = m.order_id
  LEFT JOIN food_service_stock_movements original
    ON original.id = m.reclassifies_movement_id
  LEFT JOIN food_service_stock_movement_lots a ON a.movement_id = m.id
  LEFT JOIN food_service_stock_lots l ON l.id = a.stock_lot_id
  WHERE m.id = p_movement_id
  GROUP BY m.id, cl.company_id, i.company_id, o.company_id, o.location_id,
    original.kind, original.company_id, original.location_id,
    original.ingredient_id, original.order_id,
    original.classified_quantity_micros, original.total_cost_centavos;

  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF NOT (
    parent_record.same_scope AND
    parent_record.location_scope AND
    parent_record.ingredient_scope AND
    parent_record.order_scope AND
    parent_record.allocation_cost_scope AND
    parent_record.reclassification_scope
  ) THEN
    RAISE EXCEPTION 'food-service movement lot scope mismatch';
  END IF;
  IF (
    parent_record.physical_delta_micros <> 0 OR
    parent_record.reserved_delta_micros <> 0
  ) AND (
    parent_record.allocation_count = 0 OR
    parent_record.allocated_physical <> parent_record.physical_delta_micros OR
    parent_record.allocated_reserved <> parent_record.reserved_delta_micros
  ) THEN
    RAISE EXCEPTION 'food-service movement lot allocations do not reconcile';
  END IF;
  IF parent_record.allocation_count > 0 AND
    parent_record.total_cost_centavos IS NOT NULL AND
    parent_record.allocated_cost_centavos <> parent_record.total_cost_centavos
  THEN
    RAISE EXCEPTION 'food-service movement lot costs do not reconcile';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_movement_parent()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM validate_food_service_movement_lot_allocation_id(COALESCE(NEW.id, OLD.id));
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_movement_lot_child()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM validate_food_service_movement_lot_allocation_id(OLD.movement_id);
  END IF;
  IF TG_OP <> 'DELETE' AND (
    TG_OP = 'INSERT' OR NEW.movement_id IS DISTINCT FROM OLD.movement_id
  ) THEN
    PERFORM validate_food_service_movement_lot_allocation_id(NEW.movement_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER food_service_stock_movements_lot_reconcile
AFTER INSERT OR UPDATE ON food_service_stock_movements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_movement_parent();--> statement-breakpoint

CREATE CONSTRAINT TRIGGER food_service_stock_movement_lots_reconcile
AFTER INSERT OR UPDATE OR DELETE ON food_service_stock_movement_lots
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_movement_lot_child();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_reservation_lot_allocation_id(p_reservation_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  parent_record record;
BEGIN
  SELECT
    r.location_id,
    r.ingredient_id,
    r.quantity_micros,
    r.unit_cost_microcentavos,
    r.status,
    COALESCE(SUM(a.quantity_micros), 0) AS allocated_quantity,
    TRUNC(COALESCE(SUM(
      a.quantity_micros * a.unit_cost_microcentavos
    ), 0) / r.quantity_micros) AS allocated_unit_cost,
    COUNT(a.stock_lot_id) AS allocation_count,
    COALESCE(BOOL_AND(
      l.company_id = o.company_id AND
      l.location_id = r.location_id AND
      l.ingredient_id = r.ingredient_id
    ), true) AS same_scope,
    o.location_id = r.location_id AND
      cl.company_id = o.company_id AND
      i.company_id = o.company_id AS parent_scope,
    COALESCE(BOOL_AND(
      a.unit_cost_microcentavos = l.unit_cost_microcentavos
    ), true) AS allocation_cost_scope,
    COALESCE(BOOL_AND(a.status = r.status), true) AS allocation_status_scope
  INTO parent_record
  FROM food_service_order_stock_reservations r
  JOIN food_service_orders o ON o.id = r.order_id
  JOIN company_locations cl ON cl.id = r.location_id
  JOIN food_service_ingredients i ON i.id = r.ingredient_id
  LEFT JOIN food_service_order_stock_allocations a ON a.reservation_id = r.id
  LEFT JOIN food_service_stock_lots l ON l.id = a.stock_lot_id
  WHERE r.id = p_reservation_id
  GROUP BY r.id, o.company_id, o.location_id, cl.company_id, i.company_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF NOT (
    parent_record.same_scope AND
    parent_record.parent_scope AND
    parent_record.allocation_cost_scope AND
    parent_record.allocation_status_scope
  ) THEN
    RAISE EXCEPTION 'food-service reservation lot scope mismatch';
  END IF;
  IF (
    parent_record.allocation_count = 0 OR
    parent_record.allocated_quantity <> parent_record.quantity_micros
  ) THEN
    RAISE EXCEPTION 'food-service reservation lot allocations do not reconcile';
  END IF;
  IF parent_record.allocated_unit_cost <> parent_record.unit_cost_microcentavos THEN
    RAISE EXCEPTION 'food-service reservation lot costs do not reconcile';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_reservation_parent()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM validate_food_service_reservation_lot_allocation_id(COALESCE(NEW.id, OLD.id));
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_reservation_lot_child()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM validate_food_service_reservation_lot_allocation_id(OLD.reservation_id);
  END IF;
  IF TG_OP <> 'DELETE' AND (
    TG_OP = 'INSERT' OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
  ) THEN
    PERFORM validate_food_service_reservation_lot_allocation_id(NEW.reservation_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER food_service_order_stock_reservations_lot_reconcile
AFTER INSERT OR UPDATE ON food_service_order_stock_reservations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_reservation_parent();--> statement-breakpoint

CREATE CONSTRAINT TRIGGER food_service_order_stock_allocations_reconcile
AFTER INSERT OR UPDATE OR DELETE ON food_service_order_stock_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_reservation_lot_child();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_food_service_immutable_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'food-service immutable record cannot be changed: %', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint

CREATE TRIGGER food_service_order_events_immutable
BEFORE UPDATE OR DELETE ON food_service_order_events
FOR EACH ROW EXECUTE FUNCTION prevent_food_service_immutable_change();--> statement-breakpoint

CREATE TRIGGER food_service_purchase_order_events_immutable
BEFORE UPDATE OR DELETE ON food_service_purchase_order_events
FOR EACH ROW EXECUTE FUNCTION prevent_food_service_immutable_change();--> statement-breakpoint

CREATE TRIGGER food_service_stock_movements_immutable
BEFORE UPDATE OR DELETE ON food_service_stock_movements
FOR EACH ROW EXECUTE FUNCTION prevent_food_service_immutable_change();--> statement-breakpoint

CREATE TRIGGER food_service_stock_movement_lots_immutable
BEFORE UPDATE OR DELETE ON food_service_stock_movement_lots
FOR EACH ROW EXECUTE FUNCTION prevent_food_service_immutable_change();--> statement-breakpoint

CREATE TRIGGER food_service_goods_receipts_immutable
BEFORE UPDATE OR DELETE ON food_service_goods_receipts
FOR EACH ROW EXECUTE FUNCTION prevent_food_service_immutable_change();--> statement-breakpoint

CREATE TRIGGER food_service_goods_receipt_lines_immutable
BEFORE UPDATE OR DELETE ON food_service_goods_receipt_lines
FOR EACH ROW EXECUTE FUNCTION prevent_food_service_immutable_change();--> statement-breakpoint

CREATE TRIGGER food_service_inventory_counts_immutable
BEFORE UPDATE OR DELETE ON food_service_inventory_counts
FOR EACH ROW EXECUTE FUNCTION prevent_food_service_immutable_change();--> statement-breakpoint

CREATE TRIGGER food_service_inventory_count_lines_immutable
BEFORE UPDATE OR DELETE ON food_service_inventory_count_lines
FOR EACH ROW EXECUTE FUNCTION prevent_food_service_immutable_change();--> statement-breakpoint

CREATE OR REPLACE FUNCTION protect_food_service_reservation_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_id IS DISTINCT FROM OLD.order_id OR
    NEW.location_id IS DISTINCT FROM OLD.location_id OR
    NEW.ingredient_id IS DISTINCT FROM OLD.ingredient_id OR
    NEW.quantity_micros IS DISTINCT FROM OLD.quantity_micros OR
    NEW.unit_cost_microcentavos IS DISTINCT FROM OLD.unit_cost_microcentavos
  THEN
    RAISE EXCEPTION 'food-service reservation identity cannot be changed';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'reserved' AND NEW.status IN ('consumed', 'released')) OR
    (OLD.status = 'consumed' AND NEW.status = 'lost')
  ) THEN
    RAISE EXCEPTION 'invalid food-service reservation status transition: % -> %',
      OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER food_service_order_stock_reservations_identity
BEFORE UPDATE ON food_service_order_stock_reservations
FOR EACH ROW EXECUTE FUNCTION protect_food_service_reservation_identity();--> statement-breakpoint

CREATE OR REPLACE FUNCTION protect_food_service_allocation_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reservation_id IS DISTINCT FROM OLD.reservation_id OR
    NEW.stock_lot_id IS DISTINCT FROM OLD.stock_lot_id OR
    NEW.quantity_micros IS DISTINCT FROM OLD.quantity_micros OR
    NEW.unit_cost_microcentavos IS DISTINCT FROM OLD.unit_cost_microcentavos
  THEN
    RAISE EXCEPTION 'food-service reservation allocation identity cannot be changed';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'reserved' AND NEW.status IN ('consumed', 'released')) OR
    (OLD.status = 'consumed' AND NEW.status = 'lost')
  ) THEN
    RAISE EXCEPTION 'invalid food-service reservation allocation status transition: % -> %',
      OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER food_service_order_stock_allocations_identity
BEFORE UPDATE ON food_service_order_stock_allocations
FOR EACH ROW EXECUTE FUNCTION protect_food_service_allocation_identity();--> statement-breakpoint

CREATE OR REPLACE FUNCTION protect_food_service_stock_lot_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id OR
    NEW.location_id IS DISTINCT FROM OLD.location_id OR
    NEW.ingredient_id IS DISTINCT FROM OLD.ingredient_id OR
    NEW.source_movement_id IS DISTINCT FROM OLD.source_movement_id OR
    NEW.lot_code IS DISTINCT FROM OLD.lot_code OR
    NEW.expires_on IS DISTINCT FROM OLD.expires_on OR
    NEW.received_at IS DISTINCT FROM OLD.received_at OR
    NEW.cost_status IS DISTINCT FROM OLD.cost_status OR
    NEW.unit_cost_microcentavos IS DISTINCT FROM OLD.unit_cost_microcentavos
  THEN
    RAISE EXCEPTION 'food-service stock lot identity and cost cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER food_service_stock_lots_identity
BEFORE UPDATE ON food_service_stock_lots
FOR EACH ROW EXECUTE FUNCTION protect_food_service_stock_lot_identity();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_stock_balance(
  p_location_id uuid,
  p_ingredient_id uuid
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  balance_record record;
BEGIN
  SELECT
    p.physical_quantity_micros,
    p.reserved_quantity_micros,
    COALESCE(SUM(l.physical_quantity_micros), 0) AS lot_physical,
    COALESCE(SUM(l.reserved_quantity_micros), 0) AS lot_reserved,
    cl.company_id = i.company_id AS position_scope,
    COALESCE(BOOL_AND(
      l.id IS NULL OR (
        l.company_id = cl.company_id AND
        EXISTS (
          SELECT 1
          FROM food_service_stock_movement_lots source_allocation
          WHERE source_allocation.movement_id = l.source_movement_id
            AND source_allocation.stock_lot_id = l.id
            AND source_allocation.physical_delta_micros > 0
            AND source_allocation.unit_cost_microcentavos = l.unit_cost_microcentavos
        )
      )
    ), true) AS lot_scope,
    COALESCE(BOOL_AND(
      l.reserved_quantity_micros = COALESCE((
        SELECT SUM(a.quantity_micros)
        FROM food_service_order_stock_allocations a
        WHERE a.stock_lot_id = l.id AND a.status = 'reserved'
      ), 0)
    ), true) AS reservation_balance
  INTO balance_record
  FROM food_service_stock_positions p
  JOIN company_locations cl ON cl.id = p.location_id
  JOIN food_service_ingredients i ON i.id = p.ingredient_id
  LEFT JOIN food_service_stock_lots l
    ON l.location_id = p.location_id AND l.ingredient_id = p.ingredient_id
  WHERE p.location_id = p_location_id AND p.ingredient_id = p_ingredient_id
  GROUP BY p.location_id, p.ingredient_id, p.physical_quantity_micros,
    p.reserved_quantity_micros, cl.company_id, i.company_id;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM food_service_stock_lots l
      WHERE l.location_id = p_location_id AND l.ingredient_id = p_ingredient_id
    ) THEN
      RAISE EXCEPTION 'food-service stock lots require a stock position';
    END IF;
    RETURN;
  END IF;
  IF NOT (
    balance_record.position_scope AND
    balance_record.lot_scope AND
    balance_record.reservation_balance
  ) THEN
    RAISE EXCEPTION 'food-service stock lot scope or reservation balance mismatch';
  END IF;
  IF balance_record.physical_quantity_micros <> balance_record.lot_physical OR
    balance_record.reserved_quantity_micros <> balance_record.lot_reserved
  THEN
    RAISE EXCEPTION 'food-service stock position and lots do not reconcile';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_stock_position_balance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM validate_food_service_stock_balance(OLD.location_id, OLD.ingredient_id);
  END IF;
  IF TG_OP <> 'DELETE' AND (
    TG_OP = 'INSERT' OR
    NEW.location_id IS DISTINCT FROM OLD.location_id OR
    NEW.ingredient_id IS DISTINCT FROM OLD.ingredient_id
  ) THEN
    PERFORM validate_food_service_stock_balance(NEW.location_id, NEW.ingredient_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER food_service_stock_positions_balance_reconcile
AFTER INSERT OR UPDATE OR DELETE ON food_service_stock_positions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_stock_position_balance();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_stock_lot_balance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM validate_food_service_stock_balance(OLD.location_id, OLD.ingredient_id);
  END IF;
  IF TG_OP <> 'DELETE' AND (
    TG_OP = 'INSERT' OR
    NEW.location_id IS DISTINCT FROM OLD.location_id OR
    NEW.ingredient_id IS DISTINCT FROM OLD.ingredient_id
  ) THEN
    PERFORM validate_food_service_stock_balance(NEW.location_id, NEW.ingredient_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER food_service_stock_lots_balance_reconcile
AFTER INSERT OR UPDATE OR DELETE ON food_service_stock_lots
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_stock_lot_balance();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_allocation_lot_balance()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_lot record;
  new_lot record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT location_id, ingredient_id INTO old_lot
    FROM food_service_stock_lots WHERE id = OLD.stock_lot_id;
    IF FOUND THEN
      PERFORM validate_food_service_stock_balance(old_lot.location_id, old_lot.ingredient_id);
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' AND (
    TG_OP = 'INSERT' OR NEW.stock_lot_id IS DISTINCT FROM OLD.stock_lot_id
  ) THEN
    SELECT location_id, ingredient_id INTO new_lot
    FROM food_service_stock_lots WHERE id = NEW.stock_lot_id;
    IF FOUND THEN
      PERFORM validate_food_service_stock_balance(new_lot.location_id, new_lot.ingredient_id);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER food_service_order_stock_allocations_lot_balance
AFTER INSERT OR UPDATE OR DELETE ON food_service_order_stock_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_allocation_lot_balance();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_purchase_order_scope_id(
  p_purchase_order_id uuid
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  valid_scope boolean;
BEGIN
  SELECT cl.company_id = po.company_id AND s.company_id = po.company_id
  INTO valid_scope
  FROM food_service_purchase_orders po
  JOIN company_locations cl ON cl.id = po.location_id
  JOIN food_service_suppliers s ON s.id = po.supplier_id
  WHERE po.id = p_purchase_order_id;
  IF FOUND AND NOT valid_scope THEN
    RAISE EXCEPTION 'food-service purchase order scope mismatch';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_purchase_order_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM validate_food_service_purchase_order_scope_id(COALESCE(NEW.id, OLD.id));
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER food_service_purchase_orders_scope
AFTER INSERT OR UPDATE ON food_service_purchase_orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_purchase_order_scope();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_purchase_order_line_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  valid_scope boolean;
BEGIN
  SELECT i.company_id = po.company_id
  INTO valid_scope
  FROM food_service_purchase_orders po
  JOIN food_service_ingredients i ON i.id = NEW.ingredient_id
  WHERE po.id = NEW.purchase_order_id;
  IF NOT FOUND OR NOT valid_scope THEN
    RAISE EXCEPTION 'food-service purchase order line scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER food_service_purchase_order_lines_scope
AFTER INSERT OR UPDATE ON food_service_purchase_order_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_purchase_order_line_scope();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_goods_receipt_scope_id(
  p_receipt_id uuid
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  valid_scope boolean;
BEGIN
  SELECT
    r.company_id = po.company_id AND
    r.location_id = po.location_id AND
    r.supplier_id = po.supplier_id
  INTO valid_scope
  FROM food_service_goods_receipts r
  JOIN food_service_purchase_orders po ON po.id = r.purchase_order_id
  WHERE r.id = p_receipt_id;
  IF FOUND AND NOT valid_scope THEN
    RAISE EXCEPTION 'food-service goods receipt scope mismatch';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_goods_receipt_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM validate_food_service_goods_receipt_scope_id(COALESCE(NEW.id, OLD.id));
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER food_service_goods_receipts_scope
AFTER INSERT OR UPDATE ON food_service_goods_receipts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_goods_receipt_scope();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_goods_receipt_line_scope_id(
  p_line_id uuid
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  valid_scope boolean;
BEGIN
  SELECT
    pol.purchase_order_id = r.purchase_order_id AND
    line.ingredient_id = pol.ingredient_id AND
    i.company_id = r.company_id AND
    (
      line.stock_movement_id IS NULL OR (
        m.company_id = r.company_id AND
        m.location_id = r.location_id AND
        m.ingredient_id = line.ingredient_id AND
        m.kind = 'entry' AND
        m.physical_delta_micros = line.accepted_base_quantity_micros AND
        m.unit_cost_microcentavos = line.actual_unit_cost_microcentavos AND
        EXISTS (
          SELECT 1
          FROM food_service_stock_lots receipt_lot
          WHERE receipt_lot.source_movement_id = m.id
            AND receipt_lot.lot_code IS NOT DISTINCT FROM line.lot_code
            AND receipt_lot.expires_on IS NOT DISTINCT FROM line.expires_on
        )
      )
    )
  INTO valid_scope
  FROM food_service_goods_receipt_lines line
  JOIN food_service_goods_receipts r ON r.id = line.receipt_id
  JOIN food_service_purchase_order_lines pol ON pol.id = line.purchase_order_line_id
  JOIN food_service_ingredients i ON i.id = line.ingredient_id
  LEFT JOIN food_service_stock_movements m ON m.id = line.stock_movement_id
  WHERE line.id = p_line_id;
  IF FOUND AND NOT valid_scope THEN
    RAISE EXCEPTION 'food-service goods receipt line scope mismatch';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_goods_receipt_line_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM validate_food_service_goods_receipt_line_scope_id(COALESCE(NEW.id, OLD.id));
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER food_service_goods_receipt_lines_scope
AFTER INSERT OR UPDATE ON food_service_goods_receipt_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_goods_receipt_line_scope();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_inventory_count_scope_id(
  p_count_id uuid
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  valid_scope boolean;
BEGIN
  SELECT cl.company_id = c.company_id
  INTO valid_scope
  FROM food_service_inventory_counts c
  JOIN company_locations cl ON cl.id = c.location_id
  WHERE c.id = p_count_id;
  IF FOUND AND NOT valid_scope THEN
    RAISE EXCEPTION 'food-service inventory count scope mismatch';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_inventory_count_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM validate_food_service_inventory_count_scope_id(COALESCE(NEW.id, OLD.id));
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER food_service_inventory_counts_scope
AFTER INSERT OR UPDATE ON food_service_inventory_counts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_inventory_count_scope();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_inventory_count_line_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  valid_scope boolean;
BEGIN
  SELECT
    i.company_id = c.company_id AND
    (
      NEW.movement_id IS NULL OR (
        m.company_id = c.company_id AND
        m.location_id = c.location_id AND
        m.ingredient_id = NEW.ingredient_id AND
        m.kind = 'correction' AND
        m.physical_delta_micros = NEW.variance_micros
      )
    )
  INTO valid_scope
  FROM food_service_inventory_counts c
  JOIN food_service_ingredients i ON i.id = NEW.ingredient_id
  LEFT JOIN food_service_stock_movements m ON m.id = NEW.movement_id
  WHERE c.id = NEW.count_id;
  IF NOT FOUND OR NOT valid_scope THEN
    RAISE EXCEPTION 'food-service inventory count line scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER food_service_inventory_count_lines_scope
AFTER INSERT ON food_service_inventory_count_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_inventory_count_line_scope();


CREATE TABLE IF NOT EXISTS "food_service_operational_checklists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id"),
  "name" varchar(160) NOT NULL,
  "schedule" jsonb NOT NULL DEFAULT '{"frequency":"daily"}'::jsonb,
  "due_time" varchar(5),
  "assigned_user_id" uuid REFERENCES "users"("id"),
  "active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_operational_checklists_due_time_check" CHECK ("due_time" IS NULL OR "due_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_operational_checklists_location_active_idx" ON "food_service_operational_checklists"("location_id", "active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_operational_checklists_location_name_unique" ON "food_service_operational_checklists"("location_id", lower("name"));--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_operational_checklist_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "checklist_id" uuid NOT NULL REFERENCES "food_service_operational_checklists"("id") ON DELETE CASCADE,
  "label" varchar(240) NOT NULL,
  "position" integer NOT NULL,
  "photo_required" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_operational_checklist_items_position_check" CHECK ("position" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_operational_checklist_items_position_unique" ON "food_service_operational_checklist_items"("checklist_id", "position");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_operational_checklist_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id"),
  "checklist_id" uuid NOT NULL REFERENCES "food_service_operational_checklists"("id"),
  "operational_date" date NOT NULL,
  "status" varchar NOT NULL DEFAULT 'in_progress',
  "notes" text,
  "revision" integer NOT NULL DEFAULT 0,
  "assigned_user_id" uuid REFERENCES "users"("id"),
  "completed_by_user_id" uuid REFERENCES "users"("id"),
  "started_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_operational_checklist_runs_lifecycle_check" CHECK (("status" = 'in_progress' AND "completed_at" IS NULL AND "completed_by_user_id" IS NULL) OR ("status" IN ('completed', 'partial') AND "completed_at" IS NOT NULL AND "completed_by_user_id" IS NOT NULL)),
  CONSTRAINT "food_service_operational_checklist_runs_revision_check" CHECK ("revision" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_operational_checklist_runs_checklist_date_unique" ON "food_service_operational_checklist_runs"("checklist_id", "operational_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_operational_checklist_runs_location_date_idx" ON "food_service_operational_checklist_runs"("location_id", "operational_date", "status");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_operational_checklist_run_items" (
  "run_id" uuid NOT NULL REFERENCES "food_service_operational_checklist_runs"("id") ON DELETE CASCADE,
  "checklist_item_id" uuid NOT NULL REFERENCES "food_service_operational_checklist_items"("id"),
  "status" varchar NOT NULL DEFAULT 'pending',
  "note" text,
  "evidence_url" text,
  "updated_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("run_id", "checklist_item_id"),
  CONSTRAINT "food_service_operational_checklist_run_items_status_check" CHECK ("status" IN ('pending', 'completed', 'not_done'))
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_operational_checklist_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_scope boolean;
BEGIN
  SELECT cl.company_id = NEW.company_id INTO valid_scope
  FROM company_locations cl WHERE cl.id = NEW.location_id;
  IF NOT FOUND OR NOT valid_scope THEN
    RAISE EXCEPTION 'food-service operational checklist scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER food_service_operational_checklists_scope
AFTER INSERT OR UPDATE ON food_service_operational_checklists
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_operational_checklist_scope();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_operational_checklist_run_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_scope boolean;
BEGIN
  SELECT c.company_id = NEW.company_id AND c.location_id = NEW.location_id
  INTO valid_scope
  FROM food_service_operational_checklists c
  WHERE c.id = NEW.checklist_id;
  IF NOT FOUND OR NOT valid_scope THEN
    RAISE EXCEPTION 'food-service operational checklist run scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER food_service_operational_checklist_runs_scope
AFTER INSERT OR UPDATE ON food_service_operational_checklist_runs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_operational_checklist_run_scope();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_operational_checklist_run_item_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_scope boolean;
BEGIN
  SELECT item.checklist_id = run.checklist_id
  INTO valid_scope
  FROM food_service_operational_checklist_runs run
  JOIN food_service_operational_checklist_items item ON item.id = NEW.checklist_item_id
  WHERE run.id = NEW.run_id;
  IF NOT FOUND OR NOT valid_scope THEN
    RAISE EXCEPTION 'food-service operational checklist run item scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER food_service_operational_checklist_run_items_scope
AFTER INSERT OR UPDATE ON food_service_operational_checklist_run_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_operational_checklist_run_item_scope();


CREATE TABLE IF NOT EXISTS "food_service_ingredient_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id"),
  "name" varchar(160) NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_ingredient_groups_position_check" CHECK ("position" >= 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_ingredient_groups_location_position_idx" ON "food_service_ingredient_groups"("location_id", "position");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_ingredient_group_items" (
  "group_id" uuid NOT NULL REFERENCES "food_service_ingredient_groups"("id") ON DELETE CASCADE,
  "ingredient_id" uuid NOT NULL REFERENCES "food_service_ingredients"("id"),
  "position" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("group_id", "ingredient_id"),
  CONSTRAINT "food_service_ingredient_group_items_position_check" CHECK ("position" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_ingredient_group_items_position_unique" ON "food_service_ingredient_group_items"("group_id", "position");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_inventory_count_models" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id"),
  "name" varchar(160) NOT NULL,
  "schedule" jsonb NOT NULL DEFAULT '{"frequency":"daily"}'::jsonb,
  "due_time" varchar(5),
  "assigned_user_id" uuid REFERENCES "users"("id"),
  "active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_inventory_count_models_due_time_check" CHECK ("due_time" IS NULL OR "due_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_inventory_count_models_location_active_idx" ON "food_service_inventory_count_models"("location_id", "active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_inventory_count_models_location_name_unique" ON "food_service_inventory_count_models"("location_id", lower("name"));--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_inventory_count_model_groups" (
  "model_id" uuid NOT NULL REFERENCES "food_service_inventory_count_models"("id") ON DELETE CASCADE,
  "group_id" uuid NOT NULL REFERENCES "food_service_ingredient_groups"("id"),
  "position" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("model_id", "group_id"),
  CONSTRAINT "food_service_inventory_count_model_groups_position_check" CHECK ("position" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_inventory_count_model_groups_position_unique" ON "food_service_inventory_count_model_groups"("model_id", "position");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_inventory_count_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id"),
  "model_id" uuid NOT NULL REFERENCES "food_service_inventory_count_models"("id"),
  "operational_date" date NOT NULL,
  "status" varchar NOT NULL DEFAULT 'in_progress',
  "revision" integer NOT NULL DEFAULT 0,
  "final_count_id" uuid REFERENCES "food_service_inventory_counts"("id"),
  "started_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "submitted_by_user_id" uuid REFERENCES "users"("id"),
  "started_at" timestamp NOT NULL DEFAULT now(),
  "submitted_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_inventory_count_drafts_lifecycle_check" CHECK (("status" = 'in_progress' AND "final_count_id" IS NULL AND "submitted_at" IS NULL AND "submitted_by_user_id" IS NULL) OR ("status" = 'submitted' AND "final_count_id" IS NOT NULL AND "submitted_at" IS NOT NULL AND "submitted_by_user_id" IS NOT NULL) OR ("status" = 'cancelled' AND "final_count_id" IS NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_inventory_count_drafts_model_date_unique" ON "food_service_inventory_count_drafts"("model_id", "operational_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_inventory_count_drafts_location_date_idx" ON "food_service_inventory_count_drafts"("location_id", "operational_date", "status");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_inventory_count_draft_lines" (
  "draft_id" uuid NOT NULL REFERENCES "food_service_inventory_count_drafts"("id") ON DELETE CASCADE,
  "group_id" uuid NOT NULL REFERENCES "food_service_ingredient_groups"("id"),
  "ingredient_id" uuid NOT NULL REFERENCES "food_service_ingredients"("id"),
  "counted_physical_micros" numeric(24,0) NOT NULL,
  "updated_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("draft_id", "group_id", "ingredient_id"),
  CONSTRAINT "food_service_inventory_count_draft_lines_counted_check" CHECK ("counted_physical_micros" >= 0)
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_count_group_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_scope boolean;
BEGIN
  SELECT cl.company_id = NEW.company_id INTO valid_scope
  FROM company_locations cl WHERE cl.id = NEW.location_id;
  IF NOT FOUND OR NOT valid_scope THEN
    RAISE EXCEPTION 'food-service count group scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER food_service_ingredient_groups_scope
AFTER INSERT OR UPDATE ON food_service_ingredient_groups
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_count_group_scope();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_count_group_item_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_scope boolean;
BEGIN
  SELECT ingredient.company_id = grouping.company_id INTO valid_scope
  FROM food_service_ingredient_groups grouping
  JOIN food_service_ingredients ingredient ON ingredient.id = NEW.ingredient_id
  WHERE grouping.id = NEW.group_id;
  IF NOT FOUND OR NOT valid_scope THEN
    RAISE EXCEPTION 'food-service count group item scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER food_service_ingredient_group_items_scope
AFTER INSERT OR UPDATE ON food_service_ingredient_group_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_count_group_item_scope();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_count_model_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_scope boolean;
BEGIN
  SELECT cl.company_id = NEW.company_id INTO valid_scope
  FROM company_locations cl WHERE cl.id = NEW.location_id;
  IF NOT FOUND OR NOT valid_scope THEN
    RAISE EXCEPTION 'food-service count model scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER food_service_inventory_count_models_scope
AFTER INSERT OR UPDATE ON food_service_inventory_count_models
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_count_model_scope();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_count_model_group_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_scope boolean;
BEGIN
  SELECT model.company_id = grouping.company_id AND model.location_id = grouping.location_id
  INTO valid_scope
  FROM food_service_inventory_count_models model
  JOIN food_service_ingredient_groups grouping ON grouping.id = NEW.group_id
  WHERE model.id = NEW.model_id;
  IF NOT FOUND OR NOT valid_scope THEN
    RAISE EXCEPTION 'food-service count model group scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER food_service_inventory_count_model_groups_scope
AFTER INSERT OR UPDATE ON food_service_inventory_count_model_groups
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_count_model_group_scope();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_count_draft_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_scope boolean;
BEGIN
  SELECT
    model.company_id = NEW.company_id AND
    model.location_id = NEW.location_id AND
    (
      NEW.final_count_id IS NULL OR EXISTS (
        SELECT 1 FROM food_service_inventory_counts final_count
        WHERE final_count.id = NEW.final_count_id
          AND final_count.company_id = NEW.company_id
          AND final_count.location_id = NEW.location_id
      )
    )
  INTO valid_scope
  FROM food_service_inventory_count_models model
  WHERE model.id = NEW.model_id;
  IF NOT FOUND OR NOT valid_scope THEN
    RAISE EXCEPTION 'food-service count draft scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER food_service_inventory_count_drafts_scope
AFTER INSERT OR UPDATE ON food_service_inventory_count_drafts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_count_draft_scope();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_count_draft_line_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_scope boolean;
BEGIN
  SELECT
    model_group.group_id = NEW.group_id AND
    group_item.ingredient_id = NEW.ingredient_id
  INTO valid_scope
  FROM food_service_inventory_count_drafts draft
  JOIN food_service_inventory_count_model_groups model_group
    ON model_group.model_id = draft.model_id AND model_group.group_id = NEW.group_id
  JOIN food_service_ingredient_group_items group_item
    ON group_item.group_id = NEW.group_id AND group_item.ingredient_id = NEW.ingredient_id
  WHERE draft.id = NEW.draft_id;
  IF NOT FOUND OR NOT valid_scope THEN
    RAISE EXCEPTION 'food-service count draft line scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER food_service_inventory_count_draft_lines_scope
AFTER INSERT OR UPDATE ON food_service_inventory_count_draft_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_count_draft_line_scope();

CREATE TABLE IF NOT EXISTS "food_service_purchase_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id"),
  "supplier_id" uuid NOT NULL REFERENCES "food_service_suppliers"("id"),
  "name" varchar(160) NOT NULL,
  "schedule" jsonb NOT NULL DEFAULT '{"frequency":"weekly","weekdays":[1]}'::jsonb,
  "due_time" varchar(5),
  "expected_lead_days" integer NOT NULL DEFAULT 0,
  "notes" text,
  "input_fingerprint" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_purchase_templates_due_time_check" CHECK ("due_time" IS NULL OR "due_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT "food_service_purchase_templates_lead_days_check" CHECK ("expected_lead_days" BETWEEN 0 AND 90)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_purchase_templates_location_name_unique" ON "food_service_purchase_templates"("location_id", lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_purchase_templates_location_active_idx" ON "food_service_purchase_templates"("location_id", "active", "due_time");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_purchase_template_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" uuid NOT NULL REFERENCES "food_service_purchase_templates"("id") ON DELETE CASCADE,
  "ingredient_id" uuid NOT NULL REFERENCES "food_service_ingredients"("id"),
  "purchase_unit_label" varchar(80) NOT NULL,
  "planned_purchase_units_micros" numeric(24,0) NOT NULL,
  "conversion_factor_micros" numeric(24,0) NOT NULL,
  "planned_base_quantity_micros" numeric(24,0) NOT NULL,
  "expected_unit_cost_microcentavos" numeric(30,0) NOT NULL,
  "notes" text,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_purchase_template_lines_values_check" CHECK ("planned_purchase_units_micros" > 0 AND "conversion_factor_micros" > 0 AND "planned_base_quantity_micros" > 0 AND "expected_unit_cost_microcentavos" >= 0 AND "position" >= 0),
  CONSTRAINT "food_service_purchase_template_lines_conversion_check" CHECK ("planned_base_quantity_micros" = ("planned_purchase_units_micros" * "conversion_factor_micros") / 1000000)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_purchase_template_lines_template_ingredient_unique" ON "food_service_purchase_template_lines"("template_id", "ingredient_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_purchase_template_lines_template_position_unique" ON "food_service_purchase_template_lines"("template_id", "position");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_purchase_template_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id"),
  "template_id" uuid NOT NULL REFERENCES "food_service_purchase_templates"("id"),
  "operational_date" date NOT NULL,
  "status" varchar NOT NULL DEFAULT 'pending',
  "purchase_order_id" uuid REFERENCES "food_service_purchase_orders"("id"),
  "resolution_reason" text,
  "resolved_by_user_id" uuid REFERENCES "users"("id"),
  "resolved_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_purchase_template_runs_lifecycle_check" CHECK (("status" = 'pending' AND "purchase_order_id" IS NULL AND "resolution_reason" IS NULL AND "resolved_by_user_id" IS NULL AND "resolved_at" IS NULL) OR ("status" = 'generating' AND "purchase_order_id" IS NULL AND "resolution_reason" IS NULL AND "resolved_by_user_id" IS NOT NULL AND "resolved_at" IS NULL) OR ("status" = 'generated' AND "purchase_order_id" IS NOT NULL AND "resolution_reason" IS NULL AND "resolved_by_user_id" IS NOT NULL AND "resolved_at" IS NOT NULL) OR ("status" = 'skipped' AND "purchase_order_id" IS NULL AND "resolution_reason" IS NOT NULL AND "resolved_by_user_id" IS NOT NULL AND "resolved_at" IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_purchase_template_runs_template_date_unique" ON "food_service_purchase_template_runs"("template_id", "operational_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_purchase_template_runs_purchase_order_unique" ON "food_service_purchase_template_runs"("purchase_order_id") WHERE "purchase_order_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_purchase_template_runs_location_date_idx" ON "food_service_purchase_template_runs"("location_id", "operational_date", "status");--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_purchase_template_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_scope boolean;
BEGIN
  SELECT location.company_id = NEW.company_id AND supplier.company_id = NEW.company_id
  INTO valid_scope
  FROM company_locations location
  JOIN food_service_suppliers supplier ON supplier.id = NEW.supplier_id
  WHERE location.id = NEW.location_id;
  IF NOT FOUND OR NOT valid_scope THEN
    RAISE EXCEPTION 'food-service purchase template scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER food_service_purchase_templates_scope
AFTER INSERT OR UPDATE ON food_service_purchase_templates
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_purchase_template_scope();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_purchase_template_line_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_scope boolean;
BEGIN
  SELECT ingredient.company_id = template.company_id
  INTO valid_scope
  FROM food_service_purchase_templates template
  JOIN food_service_ingredients ingredient ON ingredient.id = NEW.ingredient_id
  WHERE template.id = NEW.template_id;
  IF NOT FOUND OR NOT valid_scope THEN
    RAISE EXCEPTION 'food-service purchase template line scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER food_service_purchase_template_lines_scope
AFTER INSERT OR UPDATE ON food_service_purchase_template_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_purchase_template_line_scope();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_food_service_purchase_template_run_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_scope boolean;
BEGIN
  SELECT
    template.company_id = NEW.company_id AND
    template.location_id = NEW.location_id AND
    (
      NEW.purchase_order_id IS NULL OR
      (
        purchase.company_id = NEW.company_id AND
        purchase.location_id = NEW.location_id AND
        purchase.supplier_id = template.supplier_id
      )
    )
  INTO valid_scope
  FROM food_service_purchase_templates template
  LEFT JOIN food_service_purchase_orders purchase ON purchase.id = NEW.purchase_order_id
  WHERE template.id = NEW.template_id;
  IF NOT FOUND OR NOT valid_scope THEN
    RAISE EXCEPTION 'food-service purchase template run scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER food_service_purchase_template_runs_scope
AFTER INSERT OR UPDATE ON food_service_purchase_template_runs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_food_service_purchase_template_run_scope();--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_food_service_purchase_template_run_terminal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('generated', 'skipped') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal purchase template run cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER food_service_purchase_template_runs_terminal_guard
BEFORE UPDATE OR DELETE ON food_service_purchase_template_runs
FOR EACH ROW EXECUTE FUNCTION guard_food_service_purchase_template_run_terminal();


CREATE OR REPLACE FUNCTION prevent_terminal_food_service_checklist_run_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'in_progress' THEN
    RAISE EXCEPTION 'terminal checklist run cannot be changed';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint
CREATE TRIGGER food_service_operational_checklist_runs_terminal_immutable
BEFORE UPDATE OR DELETE ON food_service_operational_checklist_runs
FOR EACH ROW EXECUTE FUNCTION prevent_terminal_food_service_checklist_run_change();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_terminal_food_service_checklist_run_item_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status varchar;
BEGIN
  SELECT status INTO parent_status
  FROM food_service_operational_checklist_runs
  WHERE id = COALESCE(NEW.run_id, OLD.run_id);
  IF parent_status <> 'in_progress' THEN
    RAISE EXCEPTION 'terminal checklist run item cannot be changed';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint
CREATE TRIGGER food_service_operational_checklist_run_items_terminal_immutable
BEFORE INSERT OR UPDATE OR DELETE ON food_service_operational_checklist_run_items
FOR EACH ROW EXECUTE FUNCTION prevent_terminal_food_service_checklist_run_item_change();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_terminal_food_service_count_draft_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'in_progress' THEN
    RAISE EXCEPTION 'terminal count draft cannot be changed';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint
CREATE TRIGGER food_service_inventory_count_drafts_terminal_immutable
BEFORE UPDATE OR DELETE ON food_service_inventory_count_drafts
FOR EACH ROW EXECUTE FUNCTION prevent_terminal_food_service_count_draft_change();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_terminal_food_service_count_draft_line_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status varchar;
BEGIN
  SELECT status INTO parent_status
  FROM food_service_inventory_count_drafts
  WHERE id = COALESCE(NEW.draft_id, OLD.draft_id);
  IF parent_status <> 'in_progress' THEN
    RAISE EXCEPTION 'terminal count draft line cannot be changed';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint
CREATE TRIGGER food_service_inventory_count_draft_lines_terminal_immutable
BEFORE INSERT OR UPDATE OR DELETE ON food_service_inventory_count_draft_lines
FOR EACH ROW EXECUTE FUNCTION prevent_terminal_food_service_count_draft_line_change();
--> statement-breakpoint
-- ==== 0058_food_service_whatsapp ====
-- Official WhatsApp channel for each food-service location.
-- Provider credentials stay outside this schema; only an opaque reference is stored.

CREATE TABLE IF NOT EXISTS "food_service_whatsapp_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id") ON DELETE CASCADE,
  "phone_number_id" varchar(64) NOT NULL,
  "waba_id" varchar(64) NOT NULL,
  "display_phone_e164" varchar(24) NOT NULL,
  "status" varchar NOT NULL DEFAULT 'pending',
  "credential_reference" text,
  "connected_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_whatsapp_connections_status_check" CHECK ("status" IN ('pending', 'connected', 'disconnected'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_whatsapp_connections_phone_number_unique" ON "food_service_whatsapp_connections"("phone_number_id");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_whatsapp_connections_location_unique" ON "food_service_whatsapp_connections"("location_id");
CREATE INDEX IF NOT EXISTS "food_service_whatsapp_connections_company_idx" ON "food_service_whatsapp_connections"("company_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_whatsapp_operators" (
  "connection_id" uuid NOT NULL REFERENCES "food_service_whatsapp_connections"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "phone_e164" varchar(24) NOT NULL,
  "role" varchar NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("connection_id", "user_id"),
  CONSTRAINT "food_service_whatsapp_operators_role_check" CHECK ("role" IN ('owner', 'admin', 'member'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_whatsapp_operators_contact_unique" ON "food_service_whatsapp_operators"("connection_id", "phone_e164");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_whatsapp_consumer_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "connection_id" uuid NOT NULL REFERENCES "food_service_whatsapp_connections"("id") ON DELETE CASCADE,
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id") ON DELETE CASCADE,
  "customer_phone_e164" varchar(24) NOT NULL,
  "active_cart_id" uuid REFERENCES "food_service_carts"("id"),
  "last_order_id" uuid REFERENCES "food_service_orders"("id"),
  "last_inbound_message_id" varchar(255),
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_whatsapp_consumer_sessions_contact_unique" ON "food_service_whatsapp_consumer_sessions"("connection_id", "customer_phone_e164");
CREATE INDEX IF NOT EXISTS "food_service_whatsapp_consumer_sessions_expiry_idx" ON "food_service_whatsapp_consumer_sessions"("expires_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_whatsapp_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "connection_id" uuid NOT NULL REFERENCES "food_service_whatsapp_connections"("id") ON DELETE CASCADE,
  "order_id" uuid REFERENCES "food_service_orders"("id"),
  "recipient_phone_e164" varchar(24) NOT NULL,
  "purpose" varchar NOT NULL,
  "body" text NOT NULL,
  "idempotency_key" varchar(200) NOT NULL,
  "status" varchar NOT NULL DEFAULT 'pending',
  "provider_message_id" varchar(255),
  "attempt_count" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "sent_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_whatsapp_outbox_purpose_check" CHECK ("purpose" IN ('consumer_reply', 'order_received', 'order_accepted', 'order_status')),
  CONSTRAINT "food_service_whatsapp_outbox_status_check" CHECK ("status" IN ('pending', 'sending', 'sent', 'failed')),
  CONSTRAINT "food_service_whatsapp_outbox_attempt_count_check" CHECK ("attempt_count" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_whatsapp_outbox_idempotency_unique" ON "food_service_whatsapp_outbox"("connection_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "food_service_whatsapp_outbox_pending_idx" ON "food_service_whatsapp_outbox"("status", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_whatsapp_inbox" (
  "message_id" varchar(255) PRIMARY KEY,
  "connection_id" uuid NOT NULL REFERENCES "food_service_whatsapp_connections"("id") ON DELETE CASCADE,
  "consumer_session_id" uuid REFERENCES "food_service_whatsapp_consumer_sessions"("id"),
  "operator_user_id" uuid REFERENCES "users"("id"),
  "sender_phone_e164" varchar(24) NOT NULL,
  "role" varchar NOT NULL,
  "text" text NOT NULL,
  "status" varchar NOT NULL DEFAULT 'pending',
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_whatsapp_inbox_role_check" CHECK ("role" IN ('operator', 'consumer')),
  CONSTRAINT "food_service_whatsapp_inbox_status_check" CHECK ("status" IN ('pending', 'processing', 'processed', 'failed')),
  CONSTRAINT "food_service_whatsapp_inbox_identity_check" CHECK (
    ("role" = 'operator' AND "operator_user_id" IS NOT NULL AND "consumer_session_id" IS NULL)
    OR
    ("role" = 'consumer' AND "consumer_session_id" IS NOT NULL AND "operator_user_id" IS NULL)
  )
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_whatsapp_inbox_pending_idx" ON "food_service_whatsapp_inbox"("status", "created_at");
--> statement-breakpoint
-- ==== 0059_company_products_and_rbac ====
-- Company-scoped product entitlements are the access authority.
-- Stripe subscriptions remain billing records and never grant access by query alone.

ALTER TABLE "company_locations" ADD CONSTRAINT "company_locations_id_company_unique" UNIQUE ("id", "company_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_product_entitlements" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "product_code" varchar NOT NULL,
  "status" varchar NOT NULL,
  "source" varchar NOT NULL,
  "valid_from" timestamp NOT NULL DEFAULT now(),
  "valid_until" timestamp,
  "source_reference" varchar(255),
  "granted_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("company_id", "product_code"),
  CONSTRAINT "company_product_entitlements_product_code_check" CHECK ("product_code" IN ('traffic', 'menu_orders', 'inventory_cmv')),
  CONSTRAINT "company_product_entitlements_status_check" CHECK ("status" IN ('active', 'expired', 'revoked')),
  CONSTRAINT "company_product_entitlements_source_check" CHECK ("source" IN ('legacy_subscription', 'stripe', 'manual')),
  CONSTRAINT "company_product_entitlements_valid_until_check" CHECK ("source" = 'manual' OR "valid_until" IS NOT NULL),
  CONSTRAINT "company_product_entitlements_valid_period_check" CHECK (("status" = 'active' AND ("valid_until" IS NULL OR "valid_until" > "valid_from")) OR ("status" IN ('expired', 'revoked') AND "valid_until" IS NOT NULL AND "valid_until" >= "valid_from")),
  CONSTRAINT "company_product_entitlements_lifecycle_check" CHECK ("status" = 'active' OR "valid_until" IS NOT NULL)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_product_entitlements_company_status_idx" ON "company_product_entitlements"("company_id", "status");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_product_entitlement_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "product_code" varchar NOT NULL,
  "event_type" varchar NOT NULL,
  "status" varchar NOT NULL,
  "source" varchar NOT NULL,
  "valid_from" timestamp NOT NULL,
  "valid_until" timestamp,
  "idempotency_key" varchar(255) NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id"),
  "metadata" jsonb,
  "occurred_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "company_product_entitlement_events_entitlement_fk" FOREIGN KEY ("company_id", "product_code") REFERENCES "company_product_entitlements"("company_id", "product_code"),
  CONSTRAINT "company_product_entitlement_events_product_code_check" CHECK ("product_code" IN ('traffic', 'menu_orders', 'inventory_cmv')),
  CONSTRAINT "company_product_entitlement_events_event_type_check" CHECK ("event_type" IN ('activated', 'renewed', 'expired', 'revoked', 'corrected')),
  CONSTRAINT "company_product_entitlement_events_status_check" CHECK ("status" IN ('active', 'expired', 'revoked')),
  CONSTRAINT "company_product_entitlement_events_source_check" CHECK ("source" IN ('legacy_subscription', 'stripe', 'manual')),
  CONSTRAINT "company_product_entitlement_events_valid_until_check" CHECK ("source" = 'manual' OR "valid_until" IS NOT NULL),
  CONSTRAINT "company_product_entitlement_events_valid_period_check" CHECK (("status" = 'active' AND ("valid_until" IS NULL OR "valid_until" > "valid_from")) OR ("status" IN ('expired', 'revoked') AND "valid_until" IS NOT NULL AND "valid_until" >= "valid_from")),
  CONSTRAINT "company_product_entitlement_events_lifecycle_check" CHECK ("status" = 'active' OR "valid_until" IS NOT NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_product_entitlement_events_idempotency_unique" ON "company_product_entitlement_events"("idempotency_key");
CREATE INDEX IF NOT EXISTS "company_product_entitlement_events_entitlement_occurred_idx" ON "company_product_entitlement_events"("company_id", "product_code", "occurred_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_company_product_entitlement_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'company_product_entitlement_events is append-only';
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "company_product_entitlement_events_append_only" ON "company_product_entitlement_events";
CREATE TRIGGER "company_product_entitlement_events_append_only" BEFORE UPDATE OR DELETE ON "company_product_entitlement_events" FOR EACH ROW EXECUTE FUNCTION prevent_company_product_entitlement_event_mutation();--> statement-breakpoint
DROP TRIGGER IF EXISTS "company_product_entitlement_events_no_truncate" ON "company_product_entitlement_events";
CREATE TRIGGER "company_product_entitlement_events_no_truncate" BEFORE TRUNCATE ON "company_product_entitlement_events" FOR EACH STATEMENT EXECUTE FUNCTION prevent_company_product_entitlement_event_mutation();--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_module_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "billing_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "offer_code" varchar NOT NULL,
  "status" varchar NOT NULL,
  "stripe_customer_id" varchar(255) NOT NULL,
  "stripe_subscription_id" varchar(255),
  "stripe_price_id" varchar(255) NOT NULL,
  "current_period_start" timestamp,
  "current_period_end" timestamp,
  "cancel_at_period_end" boolean NOT NULL DEFAULT false,
  "canceled_at" timestamp,
  "last_provider_event_at" timestamp,
  "last_provider_event_id" varchar(255),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "company_module_subscriptions_offer_code_check" CHECK ("offer_code" IN ('menu_orders', 'inventory_cmv', 'operation_complete')),
  CONSTRAINT "company_module_subscriptions_status_check" CHECK ("status" IN ('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_module_subscriptions_stripe_subscription_unique" ON "company_module_subscriptions"("stripe_subscription_id") WHERE "stripe_subscription_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "company_module_subscriptions_company_idx" ON "company_module_subscriptions"("company_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_member_access_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "capability" varchar NOT NULL,
  "location_id" uuid,
  "granted_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "revoked_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "company_member_access_grants_membership_fk" FOREIGN KEY ("user_id", "company_id") REFERENCES "user_companies"("user_id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "company_member_access_grants_location_company_fk" FOREIGN KEY ("location_id", "company_id") REFERENCES "company_locations"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "company_member_access_grants_capability_check" CHECK ("capability" IN ('company:manage', 'billing:manage', 'members:manage', 'menu:view', 'menu:manage_base', 'menu:manage_unit', 'orders:view', 'orders:operate', 'whatsapp:manage', 'inventory:view', 'inventory:operate', 'inventory:manage', 'purchasing:view', 'purchasing:operate', 'cmv:view'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_member_access_grants_scope_unique" ON "company_member_access_grants"("company_id", "user_id", "capability", COALESCE("location_id", '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS "company_member_access_grants_member_idx" ON "company_member_access_grants"("company_id", "user_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "email" varchar(320) NOT NULL,
  "company_role" varchar NOT NULL DEFAULT 'member',
  "token_hash" text NOT NULL,
  "status" varchar NOT NULL DEFAULT 'pending',
  "invited_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "accepted_by_user_id" uuid REFERENCES "users"("id"),
  "expires_at" timestamp NOT NULL,
  "accepted_at" timestamp,
  "revoked_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "company_invitations_token_hash_unique" UNIQUE ("token_hash"),
  CONSTRAINT "company_invitations_id_company_unique" UNIQUE ("id", "company_id"),
  CONSTRAINT "company_invitations_company_role_check" CHECK ("company_role" IN ('admin', 'member')),
  CONSTRAINT "company_invitations_status_check" CHECK ("status" IN ('pending', 'accepted', 'revoked', 'expired')),
  CONSTRAINT "company_invitations_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "company_invitations_lifecycle_check" CHECK (("status" = 'pending' AND "accepted_by_user_id" IS NULL AND "accepted_at" IS NULL AND "revoked_at" IS NULL) OR ("status" = 'accepted' AND "accepted_by_user_id" IS NOT NULL AND "accepted_at" IS NOT NULL AND "accepted_at" >= "created_at" AND "accepted_at" <= "expires_at" AND "revoked_at" IS NULL) OR ("status" = 'revoked' AND "accepted_by_user_id" IS NULL AND "accepted_at" IS NULL AND "revoked_at" IS NOT NULL AND "revoked_at" >= "created_at") OR ("status" = 'expired' AND "accepted_by_user_id" IS NULL AND "accepted_at" IS NULL AND "revoked_at" IS NULL))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_invitations_company_status_idx" ON "company_invitations"("company_id", "status");
CREATE INDEX IF NOT EXISTS "company_invitations_expires_at_idx" ON "company_invitations"("expires_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_invitation_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "invitation_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "capability" varchar NOT NULL,
  "location_id" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "company_invitation_grants_invitation_company_fk" FOREIGN KEY ("invitation_id", "company_id") REFERENCES "company_invitations"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "company_invitation_grants_location_company_fk" FOREIGN KEY ("location_id", "company_id") REFERENCES "company_locations"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "company_invitation_grants_capability_check" CHECK ("capability" IN ('company:manage', 'billing:manage', 'members:manage', 'menu:view', 'menu:manage_base', 'menu:manage_unit', 'orders:view', 'orders:operate', 'whatsapp:manage', 'inventory:view', 'inventory:operate', 'inventory:manage', 'purchasing:view', 'purchasing:operate', 'cmv:view'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_invitation_grants_scope_unique" ON "company_invitation_grants"("invitation_id", "capability", COALESCE("location_id", '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
-- ==== 0060_food_service_menu_import ====
ALTER TABLE "food_service_menus" ADD CONSTRAINT "food_service_menus_id_company_unique" UNIQUE ("id", "company_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_menu_import_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "menu_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "normalized_url" text NOT NULL,
  "provider" varchar NOT NULL,
  "adapter_version" varchar(80) NOT NULL,
  "status" varchar NOT NULL DEFAULT 'queued',
  "idempotency_key" varchar(200) NOT NULL,
  "request_fingerprint" varchar(64) NOT NULL,
  "source_fingerprint" varchar(64),
  "source_document" jsonb,
  "workflow_run_id" varchar(255),
  "attempt_count" integer NOT NULL DEFAULT 0,
  "counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error_code" varchar(120),
  "error_detail" text,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_menu_import_jobs_id_company_menu_unique" UNIQUE ("id", "company_id", "menu_id"),
  CONSTRAINT "food_service_menu_import_jobs_menu_company_fk" FOREIGN KEY ("menu_id", "company_id") REFERENCES "food_service_menus"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_import_jobs_location_company_fk" FOREIGN KEY ("location_id", "company_id") REFERENCES "company_locations"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_import_jobs_provider_check" CHECK ("provider" IN ('anota_ai', 'brendi', 'ifood', 'generic_web')),
  CONSTRAINT "food_service_menu_import_jobs_status_check" CHECK ("status" IN ('queued', 'extracting', 'normalizing', 'analyzing', 'needs_review', 'ready', 'publishing', 'published', 'failed', 'cancelled')),
  CONSTRAINT "food_service_menu_import_jobs_terminal_timestamp_check" CHECK (("status" IN ('published', 'failed', 'cancelled') AND "completed_at" IS NOT NULL) OR ("status" NOT IN ('published', 'failed', 'cancelled') AND "completed_at" IS NULL)),
  CONSTRAINT "food_service_menu_import_jobs_attempt_count_check" CHECK ("attempt_count" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_menu_import_jobs_company_idempotency_unique" ON "food_service_menu_import_jobs"("company_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "food_service_menu_import_jobs_company_status_idx" ON "food_service_menu_import_jobs"("company_id", "status", "created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_menu_import_drafts" (
  "job_id" uuid PRIMARY KEY,
  "company_id" uuid NOT NULL,
  "menu_id" uuid NOT NULL,
  "schema_version" integer NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "document" jsonb NOT NULL,
  "resolved_mappings" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "document_fingerprint" varchar(64) NOT NULL,
  "validation_summary" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_menu_import_drafts_job_company_menu_unique" UNIQUE ("job_id", "company_id", "menu_id"),
  CONSTRAINT "food_service_menu_import_drafts_job_company_menu_fk" FOREIGN KEY ("job_id", "company_id", "menu_id") REFERENCES "food_service_menu_import_jobs"("id", "company_id", "menu_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_import_drafts_revision_check" CHECK ("revision" > 0 AND "schema_version" > 0)
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_menu_import_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "menu_id" uuid NOT NULL,
  "field_path" text NOT NULL,
  "code" varchar(120) NOT NULL,
  "severity" varchar NOT NULL,
  "message" text NOT NULL,
  "confidence_basis_points" integer NOT NULL,
  "status" varchar NOT NULL DEFAULT 'open',
  "resolution" text,
  "resolved_by_user_id" uuid REFERENCES "users"("id"),
  "resolved_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_menu_import_issues_draft_company_menu_fk" FOREIGN KEY ("job_id", "company_id", "menu_id") REFERENCES "food_service_menu_import_drafts"("job_id", "company_id", "menu_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_import_issues_severity_check" CHECK ("severity" IN ('blocking', 'warning')),
  CONSTRAINT "food_service_menu_import_issues_status_check" CHECK ("status" IN ('open', 'resolved')),
  CONSTRAINT "food_service_menu_import_issues_confidence_check" CHECK ("confidence_basis_points" BETWEEN 0 AND 10000),
  CONSTRAINT "food_service_menu_import_issues_resolution_check" CHECK (("status" = 'open' AND "resolution" IS NULL AND "resolved_by_user_id" IS NULL AND "resolved_at" IS NULL) OR ("status" = 'resolved' AND "resolution" IS NOT NULL AND "resolved_by_user_id" IS NOT NULL AND "resolved_at" IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_menu_import_issues_job_status_idx" ON "food_service_menu_import_issues"("job_id", "status", "severity");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_menu_import_blobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "menu_id" uuid NOT NULL,
  "job_id" uuid NOT NULL,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "content_hash" varchar(64) NOT NULL,
  "generation_id" uuid NOT NULL,
  "blob_url" text,
  "blob_etag" varchar(256),
  "pathname" text NOT NULL,
  "mime_type" varchar NOT NULL,
  "byte_size" integer NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "attempt_token" uuid NOT NULL,
  "status" varchar NOT NULL DEFAULT 'uploading',
  "lease_expires_at" timestamp,
  "referenced_at" timestamp,
  "deleted_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_menu_import_blobs_menu_company_fk" FOREIGN KEY ("menu_id", "company_id") REFERENCES "food_service_menus"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_import_blobs_job_company_menu_fk" FOREIGN KEY ("job_id", "company_id", "menu_id") REFERENCES "food_service_menu_import_jobs"("id", "company_id", "menu_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_import_blobs_hash_check" CHECK ("content_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "food_service_menu_import_blobs_bounds_check" CHECK ("byte_size" BETWEEN 1 AND 8388608 AND "width" BETWEEN 1 AND 8192 AND "height" BETWEEN 1 AND 8192 AND "width"::bigint * "height"::bigint <= 40000000),
  CONSTRAINT "food_service_menu_import_blobs_status_check" CHECK ("status" IN ('uploading', 'temporary', 'referenced', 'deleting', 'deleted')),
  CONSTRAINT "food_service_menu_import_blobs_mime_check" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT "food_service_menu_import_blobs_lifecycle_check" CHECK (("status" = 'uploading' AND "blob_url" IS NULL AND "blob_etag" IS NULL AND "lease_expires_at" IS NOT NULL AND "referenced_at" IS NULL AND "deleted_at" IS NULL) OR ("status" = 'temporary' AND "blob_url" IS NOT NULL AND "blob_etag" IS NOT NULL AND "lease_expires_at" IS NULL AND "referenced_at" IS NULL AND "deleted_at" IS NULL) OR ("status" = 'referenced' AND "blob_url" IS NOT NULL AND "blob_etag" IS NOT NULL AND "pathname" IS NOT NULL AND "lease_expires_at" IS NULL AND "referenced_at" IS NOT NULL AND "deleted_at" IS NULL) OR ("status" = 'deleting' AND "blob_url" IS NOT NULL AND "blob_etag" IS NOT NULL AND "referenced_at" IS NULL AND "deleted_at" IS NULL) OR ("status" = 'deleted' AND "blob_url" IS NULL AND "blob_etag" IS NULL AND "lease_expires_at" IS NULL AND "referenced_at" IS NULL AND "deleted_at" IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_menu_import_blobs_scope_hash_unique" ON "food_service_menu_import_blobs"("company_id", "menu_id", "content_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_menu_import_blobs_blob_url_unique" ON "food_service_menu_import_blobs"("blob_url");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_menu_import_blobs_pathname_unique" ON "food_service_menu_import_blobs"("pathname");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_menu_import_blobs_cleanup_idx" ON "food_service_menu_import_blobs"("status", "updated_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_menu_catalog_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "menu_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "source_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "warning_summary" jsonb NOT NULL DEFAULT '{"imageFailures":{"count":0,"acknowledged":false,"byCode":{}}}'::jsonb,
  "fingerprint" varchar(64) NOT NULL,
  "origin" varchar NOT NULL,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "source_job_id" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_menu_catalog_versions_menu_sequence_unique" UNIQUE ("menu_id", "sequence"),
  CONSTRAINT "food_service_menu_catalog_versions_menu_company_fk" FOREIGN KEY ("menu_id", "company_id") REFERENCES "food_service_menus"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_catalog_versions_source_job_company_menu_fk" FOREIGN KEY ("source_job_id", "company_id", "menu_id") REFERENCES "food_service_menu_import_jobs"("id", "company_id", "menu_id"),
  CONSTRAINT "food_service_menu_catalog_versions_origin_check" CHECK ("origin" IN ('imported', 'restored')),
  CONSTRAINT "food_service_menu_catalog_versions_sequence_check" CHECK ("sequence" > 0)
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_food_service_menu_catalog_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'food_service_menu_catalog_versions is append-only';
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "food_service_menu_catalog_versions_append_only" ON "food_service_menu_catalog_versions";
CREATE TRIGGER "food_service_menu_catalog_versions_append_only" BEFORE UPDATE OR DELETE ON "food_service_menu_catalog_versions" FOR EACH ROW EXECUTE FUNCTION prevent_food_service_menu_catalog_version_mutation();--> statement-breakpoint
DROP TRIGGER IF EXISTS "food_service_menu_catalog_versions_no_truncate" ON "food_service_menu_catalog_versions";
CREATE TRIGGER "food_service_menu_catalog_versions_no_truncate" BEFORE TRUNCATE ON "food_service_menu_catalog_versions" FOR EACH STATEMENT EXECUTE FUNCTION prevent_food_service_menu_catalog_version_mutation();--> statement-breakpoint

CREATE OR REPLACE FUNCTION retain_food_service_menu_catalog_versions_after_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM food_service_menu_catalog_versions
  WHERE id IN (
    SELECT id
    FROM food_service_menu_catalog_versions
    WHERE company_id = NEW.company_id AND menu_id = NEW.menu_id
    ORDER BY sequence DESC
    OFFSET 5
  );
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "food_service_menu_catalog_versions_retain_five" ON "food_service_menu_catalog_versions";
CREATE TRIGGER "food_service_menu_catalog_versions_retain_five" AFTER INSERT ON "food_service_menu_catalog_versions" FOR EACH ROW EXECUTE FUNCTION retain_food_service_menu_catalog_versions_after_insert();--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_menu_catalog_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "menu_id" uuid NOT NULL,
  "operation_key" varchar(200) NOT NULL,
  "request_fingerprint" varchar(64) NOT NULL,
  "origin" varchar NOT NULL,
  "version_id" uuid NOT NULL,
  "version_sequence" integer NOT NULL,
  "version_fingerprint" varchar(64) NOT NULL,
  "source_job_id" uuid,
  "source_version_id" uuid,
  "failed_image_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_menu_catalog_operations_menu_company_fk" FOREIGN KEY ("menu_id", "company_id") REFERENCES "food_service_menus"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_catalog_operations_origin_check" CHECK ("origin" IN ('imported', 'restored')),
  CONSTRAINT "food_service_menu_catalog_operations_sequence_check" CHECK ("version_sequence" > 0 AND "failed_image_count" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_menu_catalog_operations_operation_key_unique" ON "food_service_menu_catalog_operations"("company_id", "menu_id", "operation_key");--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_food_service_menu_catalog_operation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'food_service_menu_catalog_operations is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "food_service_menu_catalog_operations_append_only" BEFORE UPDATE OR DELETE ON "food_service_menu_catalog_operations" FOR EACH ROW EXECUTE FUNCTION prevent_food_service_menu_catalog_operation_mutation();--> statement-breakpoint
CREATE TRIGGER "food_service_menu_catalog_operations_no_truncate" BEFORE TRUNCATE ON "food_service_menu_catalog_operations" FOR EACH STATEMENT EXECUTE FUNCTION prevent_food_service_menu_catalog_operation_mutation();--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_menu_source_refs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "menu_id" uuid NOT NULL,
  "provider" varchar NOT NULL,
  "entity_type" varchar NOT NULL,
  "external_id" varchar(200) NOT NULL,
  "local_entity_type" varchar NOT NULL,
  "local_entity_id" uuid NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_menu_source_refs_menu_company_fk" FOREIGN KEY ("menu_id", "company_id") REFERENCES "food_service_menus"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_source_refs_provider_check" CHECK ("provider" IN ('anota_ai', 'brendi', 'ifood', 'generic_web')),
  CONSTRAINT "food_service_menu_source_refs_entity_type_check" CHECK ("entity_type" IN ('category', 'item', 'option_group', 'option') AND "local_entity_type" IN ('category', 'item', 'option_group', 'option'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_menu_source_refs_external_identity_unique" ON "food_service_menu_source_refs"("company_id", "menu_id", "provider", "entity_type", "external_id");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_menu_source_refs_local_identity_unique" ON "food_service_menu_source_refs"("company_id", "menu_id", "provider", "local_entity_type", "local_entity_id");
--> statement-breakpoint
-- ==== 0061_food_service_ifood_connection ====
-- Company-scoped iFood merchant grant. App credentials and access tokens
-- stay outside this schema; only the authorized merchant id is stored.

CREATE TABLE IF NOT EXISTS "food_service_ifood_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "merchant_id" varchar(200) NOT NULL,
  "merchant_name" varchar(160),
  "catalog_id" varchar(200),
  "status" varchar NOT NULL DEFAULT 'connected',
  "connected_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_ifood_connections_status_check" CHECK ("status" IN ('connected', 'revoked'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_ifood_connections_company_unique" ON "food_service_ifood_connections"("company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_ifood_connections_merchant_unique" ON "food_service_ifood_connections"("merchant_id") WHERE "status" = 'connected';
