CREATE TABLE "product_refund_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "product_orders"("id"),
  "buyer_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "protocol" varchar(32) NOT NULL,
  "status" varchar DEFAULT 'requested' NOT NULL,
  "requested_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_refund_requests_order_unique" UNIQUE("order_id"),
  CONSTRAINT "product_refund_requests_protocol_unique" UNIQUE("protocol")
);
CREATE INDEX "product_refund_requests_buyer_requested_idx"
  ON "product_refund_requests" USING btree ("buyer_user_id", "requested_at");
