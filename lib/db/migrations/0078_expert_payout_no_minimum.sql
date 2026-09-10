-- Saque legado sem mínimo (ticket 17, R20).
-- Gêmea byte-a-byte entre automatize-frontend (0086) e backoffice (0078), com o
-- MESMO `when` (1796500000000): a marca d'água é compartilhada e só uma das duas
-- aplica. Só afasta o piso de R$100 — qualquer Saldo de Repasse Legado
-- disponível e positivo pode ser sacado por inteiro, inclusive R$0,01. Zero e
-- negativo continuam impedidos pelo novo CHECK.

ALTER TABLE "expert_payout_requests"
  DROP CONSTRAINT IF EXISTS "expert_payout_requests_minimum_amount";--> statement-breakpoint

ALTER TABLE "expert_payout_requests"
  DROP CONSTRAINT IF EXISTS "expert_payout_requests_positive_amount";--> statement-breakpoint

ALTER TABLE "expert_payout_requests"
  ADD CONSTRAINT "expert_payout_requests_positive_amount"
  CHECK ("amount_centavos" > 0);
