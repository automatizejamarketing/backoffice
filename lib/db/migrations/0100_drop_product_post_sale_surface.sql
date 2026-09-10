-- Corte do pós-venda automatizado: reembolso, contestação, defesa, evidências,
-- fraude Pix, custos pós-venda e casos de divergência. O produto passou a
-- reagir ao evento do provedor revogando o Acesso, e nada mais escreve aqui.
--
-- A coluna de suspensão por fraude sai primeiro porque referencia a tabela de
-- casos. A ordem das quedas segue a dependência: filha antes da mãe.
ALTER TABLE "product_entitlements"
  DROP COLUMN IF EXISTS "suspended_by_pix_fraud_case_id";--> statement-breakpoint
DROP TABLE IF EXISTS "product_dispute_defence_files";--> statement-breakpoint
DROP TABLE IF EXISTS "product_dispute_defence_upload_grants";--> statement-breakpoint
DROP TABLE IF EXISTS "product_dispute_defences";--> statement-breakpoint
DROP TABLE IF EXISTS "product_card_dispute_events";--> statement-breakpoint
DROP TABLE IF EXISTS "product_card_disputes";--> statement-breakpoint
DROP TABLE IF EXISTS "product_pix_fraud_events";--> statement-breakpoint
DROP TABLE IF EXISTS "product_pix_fraud_cases";--> statement-breakpoint
DROP TABLE IF EXISTS "product_post_sale_cost_movements";--> statement-breakpoint
DROP TABLE IF EXISTS "product_post_sale_cost_settlements";--> statement-breakpoint
DROP TABLE IF EXISTS "product_post_sale_cost_cases";--> statement-breakpoint
DROP TABLE IF EXISTS "product_evidence_consultations";--> statement-breakpoint
DROP TABLE IF EXISTS "product_purchase_evidence";--> statement-breakpoint
DROP TABLE IF EXISTS "product_refund_operations";--> statement-breakpoint
DROP TABLE IF EXISTS "product_refund_balance_cases";--> statement-breakpoint
DROP TABLE IF EXISTS "product_refund_requests";--> statement-breakpoint
DROP TABLE IF EXISTS "product_reconciliation_cases";
