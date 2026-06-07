-- Drop dead AI-chat tables (Vercel AI Chatbot template leftovers).
-- All code references were removed beforehand; tables are empty in staging.
-- Idempotent (IF EXISTS) so this is a no-op if the frontend mirror migration ran first.
ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_chat_id_chats_id_fk";
--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN IF EXISTS "chat_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "votes";
--> statement-breakpoint
DROP TABLE IF EXISTS "streams";
--> statement-breakpoint
DROP TABLE IF EXISTS "suggestions";
--> statement-breakpoint
DROP TABLE IF EXISTS "messages";
--> statement-breakpoint
DROP TABLE IF EXISTS "documents";
--> statement-breakpoint
DROP TABLE IF EXISTS "chats";
