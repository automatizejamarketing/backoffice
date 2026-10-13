-- Histórico de users.expiration_date. A coluna guarda só o valor mais recente,
-- então um cliente que expirou e renovou depois parecia nunca ter saído, e o
-- painel não conseguia fixar o churn no dia da saída. Os triggers gravam toda
-- mudança, venha de qualquer app, script ou SQL manual. SECURITY DEFINER para
-- que um UPDATE em users nunca falhe por falta de permissão na tabela nova.
-- Shared FE 0142 / BO 0133, same `when` (1802050000000): first apply wins.

CREATE TABLE IF NOT EXISTS "user_expiration_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "previous_expiration_date" timestamp with time zone,
  "expiration_date" timestamp with time zone,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_expiration_history_user_changed_at_idx"
  ON "user_expiration_history" USING btree ("user_id", "changed_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION record_user_expiration_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_expiration_history (
    user_id,
    previous_expiration_date,
    expiration_date,
    changed_at
  )
  VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.expiration_date END,
    NEW.expiration_date,
    clock_timestamp()
  );
  RETURN NULL;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS users_record_expiration_insert ON users;--> statement-breakpoint

CREATE TRIGGER users_record_expiration_insert
AFTER INSERT ON users
FOR EACH ROW
WHEN (NEW.expiration_date IS NOT NULL)
EXECUTE PROCEDURE record_user_expiration_change();--> statement-breakpoint

DROP TRIGGER IF EXISTS users_record_expiration_update ON users;--> statement-breakpoint

CREATE TRIGGER users_record_expiration_update
AFTER UPDATE OF expiration_date ON users
FOR EACH ROW
WHEN (OLD.expiration_date IS DISTINCT FROM NEW.expiration_date)
EXECUTE PROCEDURE record_user_expiration_change();
