-- M2 — drop de todo objeto Vindi do banco (ticket 25).
-- Espelhada byte a byte no repo irmão com o MESMO `when` (1795100000000); os dois arquivos
-- precisam ficar idênticos (tests/migration-journal.test.ts).
--
-- Ordem: pré-condição → CHECK sem o ramo `vindi_split_v1` → índices → colunas → tabelas.
-- Tudo idempotente: rodar de novo depois de aplicada não erra e não faz nada.
--
-- PRÉ-CONDIÇÃO: aborta a migração inteira (e portanto o deploy) se sobrar QUALQUER linha Vindi.
-- Purgue os dados antes (ticket 24 em produção; limpeza equivalente na staging).

DO $$
DECLARE
  restos text[] := ARRAY[]::text[];
  total  bigint;
  alvo   record;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
        ('vindi_payment_links'),
        ('vindi_customers'),
        ('vindi_webhook_events')
    ) AS t(tabela)
  LOOP
    IF to_regclass('public.' || alvo.tabela) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', alvo.tabela) INTO total;
      IF total > 0 THEN
        restos := restos || format('%s: %s linha(s)', alvo.tabela, total);
      END IF;
    END IF;
  END LOOP;

  FOR alvo IN
    SELECT * FROM (VALUES
        ('billing_notification_deliveries', 'vindi_charge_id'),
        ('expert_profiles', 'vindi_affiliate_id'),
        ('payments', 'vindi_bill_id'),
        ('payments', 'vindi_charge_id'),
        ('payments', 'vindi_customer_id'),
        ('product_orders', 'vindi_bill_id'),
        ('product_orders', 'vindi_charge_id'),
        ('product_orders', 'vindi_affiliate_id'),
        ('product_orders', 'vindi_customer_id'),
        ('product_payments', 'vindi_bill_id'),
        ('product_payments', 'vindi_charge_id'),
        ('product_payments', 'vindi_affiliate_id'),
        ('subscriptions', 'vindi_subscription_id'),
        ('subscriptions', 'vindi_payment_method'),
        ('subscriptions', 'vindi_consent_status'),
        ('subscriptions', 'vindi_consent_updated_at'),
        ('subscriptions', 'vindi_consent_authorized_at'),
        ('subscriptions', 'vindi_consent_expires_at'),
        ('users', 'vindi_customer_id'),
        ('product_orders', 'expert_participation_bps'),
        ('product_orders', 'processing_fee_basis_points'),
        ('product_orders', 'expert_amount_centavos'),
        ('product_orders', 'platform_theoretical_amount_centavos'),
        ('product_payments', 'expert_participation_bps'),
        ('product_payments', 'processing_fee_basis_points'),
        ('product_payments', 'expert_amount_centavos'),
        ('product_payments', 'platform_theoretical_amount_centavos')
    ) AS t(tabela, coluna)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = alvo.tabela AND column_name = alvo.coluna
    ) THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NOT NULL', alvo.tabela, alvo.coluna)
        INTO total;
      IF total > 0 THEN
        restos := restos || format('%s.%s: %s linha(s)', alvo.tabela, alvo.coluna, total);
      END IF;
    END IF;
  END LOOP;

  -- `expert_profiles.vindi_affiliate_status` e NOT NULL DEFAULT 'unverified': exigir IS NULL
  -- nela seria uma pre-condicao impossivel de satisfazer. O equivalente honesto e' exigir que
  -- nenhum Expert carregue status diferente do padrao, ou seja, nenhum vinculo Vindi vivo.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'expert_profiles'
       AND column_name = 'vindi_affiliate_status'
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.expert_profiles'
            || ' WHERE vindi_affiliate_status IS DISTINCT FROM ''unverified''' INTO total;
    IF total > 0 THEN
      restos := restos || format('expert_profiles.vindi_affiliate_status <> unverified: %s linha(s)', total);
    END IF;
  END IF;

  FOR alvo IN
    SELECT * FROM (VALUES
        ('subscriptions', 'provider', 'vindi'),
        ('payments', 'provider', 'vindi'),
        ('product_payments', 'provider', 'vindi'),
        ('product_orders', 'financial_model', 'vindi_split_v1'),
        ('product_payments', 'financial_model', 'vindi_split_v1')
    ) AS t(tabela, coluna, valor)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = alvo.tabela AND column_name = alvo.coluna
    ) THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = %L', alvo.tabela, alvo.coluna, alvo.valor)
        INTO total;
      IF total > 0 THEN
        restos := restos || format('%s.%s = %s: %s linha(s)', alvo.tabela, alvo.coluna, alvo.valor, total);
      END IF;
    END IF;
  END LOOP;

  IF array_length(restos, 1) > 0 THEN
    RAISE EXCEPTION 'M2 abortada: ainda existe dado Vindi no banco -> %', array_to_string(restos, '; ')
      USING HINT = 'Purgue o residuo Vindi antes de aplicar esta migracao (ticket 24).';
  END IF;
END $$;--> statement-breakpoint

-- O CHECK precisa perder o ramo `vindi_split_v1` ANTES das colunas que ele lê serem dropadas.
ALTER TABLE "product_orders"
  DROP CONSTRAINT IF EXISTS "product_orders_snapshot_consistency";--> statement-breakpoint

DROP INDEX IF EXISTS "billing_notification_deliveries_vindi_charge_type_channel_uniqu";--> statement-breakpoint
DROP INDEX IF EXISTS "expert_profiles_vindi_affiliate_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "payments_vindi_charge_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "product_payments_vindi_charge_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "subscriptions_vindi_subscription_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "users_vindi_customer_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "subscription_events_payment_failed_charge_unique";--> statement-breakpoint

ALTER TABLE "billing_notification_deliveries"
  DROP COLUMN IF EXISTS "vindi_charge_id";--> statement-breakpoint

ALTER TABLE "expert_profiles"
  DROP COLUMN IF EXISTS "vindi_affiliate_id";--> statement-breakpoint
ALTER TABLE "expert_profiles"
  DROP COLUMN IF EXISTS "vindi_affiliate_status";--> statement-breakpoint

ALTER TABLE "payments"
  DROP COLUMN IF EXISTS "vindi_bill_id";--> statement-breakpoint
ALTER TABLE "payments"
  DROP COLUMN IF EXISTS "vindi_charge_id";--> statement-breakpoint
ALTER TABLE "payments"
  DROP COLUMN IF EXISTS "vindi_customer_id";--> statement-breakpoint

ALTER TABLE "product_orders"
  DROP COLUMN IF EXISTS "vindi_bill_id";--> statement-breakpoint
ALTER TABLE "product_orders"
  DROP COLUMN IF EXISTS "vindi_charge_id";--> statement-breakpoint
ALTER TABLE "product_orders"
  DROP COLUMN IF EXISTS "vindi_affiliate_id";--> statement-breakpoint
ALTER TABLE "product_orders"
  DROP COLUMN IF EXISTS "vindi_customer_id";--> statement-breakpoint
ALTER TABLE "product_orders"
  DROP COLUMN IF EXISTS "expert_participation_bps";--> statement-breakpoint
ALTER TABLE "product_orders"
  DROP COLUMN IF EXISTS "processing_fee_basis_points";--> statement-breakpoint
ALTER TABLE "product_orders"
  DROP COLUMN IF EXISTS "expert_amount_centavos";--> statement-breakpoint
ALTER TABLE "product_orders"
  DROP COLUMN IF EXISTS "platform_theoretical_amount_centavos";--> statement-breakpoint

ALTER TABLE "product_payments"
  DROP COLUMN IF EXISTS "vindi_bill_id";--> statement-breakpoint
ALTER TABLE "product_payments"
  DROP COLUMN IF EXISTS "vindi_charge_id";--> statement-breakpoint
ALTER TABLE "product_payments"
  DROP COLUMN IF EXISTS "vindi_affiliate_id";--> statement-breakpoint
ALTER TABLE "product_payments"
  DROP COLUMN IF EXISTS "expert_participation_bps";--> statement-breakpoint
ALTER TABLE "product_payments"
  DROP COLUMN IF EXISTS "processing_fee_basis_points";--> statement-breakpoint
ALTER TABLE "product_payments"
  DROP COLUMN IF EXISTS "expert_amount_centavos";--> statement-breakpoint
ALTER TABLE "product_payments"
  DROP COLUMN IF EXISTS "platform_theoretical_amount_centavos";--> statement-breakpoint

ALTER TABLE "subscriptions"
  DROP COLUMN IF EXISTS "vindi_subscription_id";--> statement-breakpoint
ALTER TABLE "subscriptions"
  DROP COLUMN IF EXISTS "vindi_payment_method";--> statement-breakpoint
ALTER TABLE "subscriptions"
  DROP COLUMN IF EXISTS "vindi_consent_status";--> statement-breakpoint
ALTER TABLE "subscriptions"
  DROP COLUMN IF EXISTS "vindi_consent_updated_at";--> statement-breakpoint
ALTER TABLE "subscriptions"
  DROP COLUMN IF EXISTS "vindi_consent_authorized_at";--> statement-breakpoint
ALTER TABLE "subscriptions"
  DROP COLUMN IF EXISTS "vindi_consent_expires_at";--> statement-breakpoint

ALTER TABLE "users"
  DROP COLUMN IF EXISTS "vindi_customer_id";--> statement-breakpoint

DROP TABLE IF EXISTS "vindi_payment_links";--> statement-breakpoint
DROP TABLE IF EXISTS "vindi_customers";--> statement-breakpoint
DROP TABLE IF EXISTS "vindi_webhook_events";--> statement-breakpoint

ALTER TABLE "product_orders"
  ADD CONSTRAINT "product_orders_snapshot_consistency"
  CHECK (

    "price_centavos" >= 0
    AND "currency" = 'brl'
    AND "expert_share_basis_points" >= 0
    AND "expert_share_basis_points" <= 10000
    AND "coproducer_share_basis_points" >= 0
    AND "coproducer_share_basis_points" <= 10000
    AND (
      (
        "financial_model" = 'legacy_net_split'
        AND "platform_fee_basis_points" IS NULL
        AND "platform_fee_fixed_centavos" IS NULL
        AND (
          ("expert_id_snapshot" IS NULL AND "expert_share_basis_points" = 0)
          OR "expert_id_snapshot" IS NOT NULL
        )
      )
      OR (
        "financial_model" = 'platform_fee_coproduction'
        AND "platform_fee_basis_points" >= 0
        AND "platform_fee_basis_points" <= 10000
        AND "platform_fee_fixed_centavos" IS NULL
        AND (
          ("expert_id_snapshot" IS NULL AND "expert_share_basis_points" = 0)
          OR "expert_id_snapshot" IS NOT NULL
        )
      )
      OR (
        "financial_model" = 'platform_fee_coproduction_v2'
        AND "platform_fee_basis_points" >= 0
        AND "platform_fee_basis_points" <= 10000
        AND "platform_fee_fixed_centavos" IS NULL
        AND (
          (
            "expert_id_snapshot" IS NULL
            AND "expert_share_basis_points" = 0
            AND "coproducer_type_snapshot" IS NULL
            AND "coproducer_expert_id_snapshot" IS NULL
            AND "coproducer_share_basis_points" = 0
          )
          OR (
            "expert_id_snapshot" IS NOT NULL
            AND "expert_share_basis_points" + "coproducer_share_basis_points" = 10000
            AND (
              (
                "coproducer_type_snapshot" IS NULL
                AND "coproducer_expert_id_snapshot" IS NULL
                AND "coproducer_share_basis_points" = 0
              )
              OR (
                "coproducer_type_snapshot" = 'automatize'
                AND "coproducer_expert_id_snapshot" IS NULL
                AND "coproducer_share_basis_points" > 0
              )
              OR (
                "coproducer_type_snapshot" = 'expert'
                AND "coproducer_expert_id_snapshot" IS NOT NULL
                AND "coproducer_expert_id_snapshot" <> "expert_id_snapshot"
                AND "coproducer_share_basis_points" > 0
              )
            )
          )
        )
      )
      OR (
        "financial_model" = 'platform_fee_coproduction_v3'
        AND "platform_fee_basis_points" >= 0
        AND "platform_fee_basis_points" <= 10000
        AND "platform_fee_fixed_centavos" >= 0
        AND (
          (
            "expert_id_snapshot" IS NULL
            AND "platform_fee_basis_points" = 0
            AND "platform_fee_fixed_centavos" = 0
            AND "expert_share_basis_points" = 0
            AND "coproducer_type_snapshot" IS NULL
            AND "coproducer_expert_id_snapshot" IS NULL
            AND "coproducer_share_basis_points" = 0
          )
          OR (
            "expert_id_snapshot" IS NOT NULL
            AND "expert_share_basis_points" + "coproducer_share_basis_points" = 10000
            AND (
              (
                "coproducer_type_snapshot" IS NULL
                AND "coproducer_expert_id_snapshot" IS NULL
                AND "coproducer_share_basis_points" = 0
              )
              OR (
                "coproducer_type_snapshot" = 'automatize'
                AND "coproducer_expert_id_snapshot" IS NULL
                AND "coproducer_share_basis_points" > 0
              )
              OR (
                "coproducer_type_snapshot" = 'expert'
                AND "coproducer_expert_id_snapshot" IS NOT NULL
                AND "coproducer_expert_id_snapshot" <> "expert_id_snapshot"
                AND "coproducer_share_basis_points" > 0
              )
            )
          )
        )
      )
      OR (
        "financial_model" = 'gateway_net_v1'
        AND "platform_fee_basis_points" = 0
        AND "platform_fee_fixed_centavos" = 0
        AND "marketplace_fee_basis_points" = 0
        AND ("gateway_fee_estimate_bps" IS NULL OR "gateway_fee_estimate_bps" >= 0)
        AND ("gateway_fee_estimate_fixed_centavos" IS NULL OR "gateway_fee_estimate_fixed_centavos" >= 0)
        AND (
          (
            "expert_id_snapshot" IS NULL
            AND "expert_share_basis_points" = 0
            AND "coproducer_type_snapshot" IS NULL
            AND "coproducer_expert_id_snapshot" IS NULL
            AND "coproducer_share_basis_points" = 0
          )
          OR (
            "expert_id_snapshot" IS NOT NULL
            AND "expert_share_basis_points" + "coproducer_share_basis_points" = 10000
            AND (
              (
                "coproducer_type_snapshot" IS NULL
                AND "coproducer_expert_id_snapshot" IS NULL
                AND "coproducer_share_basis_points" = 0
              )
              OR (
                "coproducer_type_snapshot" = 'automatize'
                AND "coproducer_expert_id_snapshot" IS NULL
                AND "coproducer_share_basis_points" > 0
              )
            )
          )
        )
      )
    )
  );
