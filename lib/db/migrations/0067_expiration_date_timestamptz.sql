-- `users.expiration_date` é a única autoridade de acesso à plataforma, e vivia
-- como `timestamp` SEM fuso. Não havia erro no app: o driver grava
-- `toISOString()`, o Postgres descarta o `Z` e guarda a hora-de-parede UTC, e o
-- drizzle relê com `+0000`. O round-trip fecha — mas só porque a sessão do
-- banco está em UTC e porque todo leitor passa pelo drizzle.
--
-- Quem lê por fora não tem essa sorte: o PostgREST devolve `2026-08-20T12:00:00`
-- sem fuso, e `new Date(...)` disso em São Paulo dá 15:00Z. Foi assim que a
-- investigação do Places 403 leu o vencimento com 3 h de diferença. Um `psql`
-- com sessão fora de UTC, ou um `expiration_date > now()` escrito em SQL cru
-- amanhã, erram do mesmo jeito e em silêncio.
--
-- Guardar o instante em vez da hora-de-parede tira a classe inteira de erro.
-- `AT TIME ZONE 'UTC'` é a conversão certa PORQUE os valores gravados são
-- hora-de-parede UTC — conferido antes de migrar, com os 63 instantes de
-- `users` e os 4 de `billing_notification_deliveries` comparados por epoch.
--
-- `billing_notification_deliveries.expiration_date` entra junto: guarda uma
-- CÓPIA do mesmo valor e participa do índice único que torna o aviso de
-- renovação idempotente. Deixar as duas com tipos diferentes seria plantar a
-- comparação cruzada que um dia converte pela timezone da sessão.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'expiration_date' AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "users"
      ALTER COLUMN "expiration_date" TYPE timestamptz
      USING "expiration_date" AT TIME ZONE 'UTC';
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'billing_notification_deliveries'
      AND column_name = 'expiration_date' AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "billing_notification_deliveries"
      ALTER COLUMN "expiration_date" TYPE timestamptz
      USING "expiration_date" AT TIME ZONE 'UTC';
  END IF;
END $$;
