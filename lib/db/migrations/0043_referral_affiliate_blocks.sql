-- Histórico de bloqueios do afiliado (achado 6 do plano de testes em docs/qa).
--
-- O problema: `referral_affiliates.status` responde "está bloqueado AGORA?", e
-- o motor de comissão precisava de outra pergunta — "estava bloqueado NAQUELA
-- data?". Com apenas o status e um `blocked_at`, reativar apagava a única
-- evidência de que houve período bloqueado. Uma fatura paga durante o bloqueio
-- e ainda não processada passava a comissionar no instante da reativação.
--
-- Note que o comportamento ENQUANTO o bloqueio dura já estava correto: uma
-- fatura anterior ao `blocked_at` sempre comissionou, como deve. O defeito
-- aparecia só depois da reativação.
--
-- Mesmo idioma de `referral_agreements`: o período encerrado é marcado, nunca
-- removido, porque é ele que explica o passado.
--
-- Limitação registrada: o backfill só alcança bloqueios VIGENTES. Afiliados
-- bloqueados e reativados antes desta migração perderam esse histórico de
-- forma irrecuperável — não havia onde ele estivesse gravado.

CREATE TABLE IF NOT EXISTS "referral_affiliate_blocks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "affiliate_id" uuid NOT NULL,
  "blocked_at" timestamp DEFAULT now() NOT NULL,
  "blocked_by" varchar(120),
  "block_reason" text,
  "unblocked_at" timestamp,
  "unblocked_by" varchar(120),
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "referral_affiliate_blocks_affiliate_id_fk"
    FOREIGN KEY ("affiliate_id") REFERENCES "public"."referral_affiliates"("id"),
  -- Um período não pode terminar antes de começar.
  CONSTRAINT "referral_affiliate_blocks_period_order"
    CHECK ("unblocked_at" IS NULL OR "unblocked_at" >= "blocked_at")
);

-- No máximo um período aberto por afiliado — a mesma trava, e pelo mesmo
-- motivo, do índice de um pedido de saque aberto: períodos sobrepostos
-- tornariam a pergunta "estava bloqueado?" ambígua.
CREATE UNIQUE INDEX IF NOT EXISTS "referral_affiliate_blocks_one_open"
  ON "referral_affiliate_blocks" USING btree ("affiliate_id")
  WHERE "unblocked_at" IS NULL;

CREATE INDEX IF NOT EXISTS "referral_affiliate_blocks_affiliate_idx"
  ON "referral_affiliate_blocks" USING btree ("affiliate_id", "blocked_at");

-- Backfill: um período aberto para cada afiliado bloqueado hoje.
INSERT INTO "referral_affiliate_blocks"
  ("affiliate_id", "blocked_at", "blocked_by", "block_reason")
SELECT
  "id",
  COALESCE("blocked_at", "updated_at", "created_at"),
  "blocked_by",
  "block_reason"
FROM "referral_affiliates"
WHERE "status" = 'blocked'
  AND NOT EXISTS (
    SELECT 1 FROM "referral_affiliate_blocks" b
    WHERE b."affiliate_id" = "referral_affiliates"."id"
      AND b."unblocked_at" IS NULL
  );
