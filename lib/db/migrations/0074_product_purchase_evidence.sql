CREATE TABLE "product_purchase_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid,
  "product_id" uuid NOT NULL,
  "content_item_id" uuid,
  "user_id" uuid NOT NULL,
  "event_type" varchar NOT NULL,
  "access_source" varchar(30),
  "occurred_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "product_purchase_evidence_order_id_product_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."product_orders"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "product_purchase_evidence_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "product_purchase_evidence_content_item_id_product_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."product_content_items"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "product_purchase_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);
CREATE INDEX "product_purchase_evidence_order_occurred_idx" ON "product_purchase_evidence" USING btree ("order_id","occurred_at");
CREATE INDEX "product_purchase_evidence_product_user_occurred_idx" ON "product_purchase_evidence" USING btree ("product_id","user_id","occurred_at");
