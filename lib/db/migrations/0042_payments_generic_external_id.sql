-- `payments.external_id` — a identidade do pagamento no provedor, numa coluna
-- que provedor nenhum é dono.
--
-- Por que existe (ADR 0025, achado N2 do plano de testes em docs/qa):
--
-- O ADR 0025 promete que "integrar um gateway novo passa a significar apenas
-- fazer ele escrever em `payments`". Isso valia para as colunas de DINHEIRO —
-- `amount`, `gross_amount`, `net_amount`, `fee_amount` são iguais para qualquer
-- gateway — e não valia para as de IDENTIDADE: `stripe_invoice_id` e
-- `mercadopago_payment_id`. Como a chave idempotente do programa de afiliados é
-- construída sobre identidade, o domínio precisava de um `switch` sobre
-- `provider`, e um gateway ausente desse switch era descartado em silêncio,
-- sem comissão e sem sequer um evento explicando a ausência.
--
-- Puramente aditiva. As colunas por gateway PERMANECEM e continuam sendo
-- escritas: muito código casa por elas, e o caminho de estorno do Stripe
-- procura a cobrança por três delas.
--
-- A trava que governa esta migração: o backfill usa EXATAMENTE o valor que o
-- `switch` antigo devolvia, com `CASE` sobre `provider` e nunca `COALESCE`. A
-- diferença não é estética — uma linha com `provider = 'stripe'` que tivesse
-- apenas o id do Mercado Pago preenchido receberia, sob `COALESCE`, uma
-- identidade que o switch nunca produziu. A chave do evento mudaria, a comissão
-- já paga seria rematerializada com chave nova, e o afiliado receberia duas
-- vezes.

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "external_id" varchar(255);

-- O backfill. `manual` (e qualquer provedor futuro sem id) fica NULL, que é o
-- que o switch devolvia — um pagamento sem identidade externa continua sem
-- chave idempotente possível, e isso é correto.
UPDATE "payments"
SET "external_id" = CASE "provider"
  WHEN 'stripe'      THEN "stripe_invoice_id"
  WHEN 'mercadopago' THEN "mercadopago_payment_id"
  ELSE NULL
END
WHERE "external_id" IS NULL;

-- A identidade é única DENTRO de um provedor. Dois gateways podem coincidir num
-- id externo sem colidir — é o mesmo raciocínio que faz a chave do evento
-- carregar o provedor (`referral:<provedor>:<id>:payment`).
--
-- Parcial porque `manual` e falhas sem fatura ficam com NULL, e no Postgres
-- cada NULL é distinto — mas o índice parcial diz a intenção em vez de depender
-- desse detalhe.
CREATE UNIQUE INDEX IF NOT EXISTS "payments_provider_external_id_unique"
  ON "payments" USING btree ("provider", "external_id")
  WHERE "external_id" IS NOT NULL;
