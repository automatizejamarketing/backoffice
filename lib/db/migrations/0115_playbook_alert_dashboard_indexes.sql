CREATE INDEX IF NOT EXISTS "performance_insights_playbook_rule_created_idx"
  ON "performance_insights" ("rule_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_insights_playbook_status_created_idx"
  ON "performance_insights" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_insights_playbook_status_reviewed_idx"
  ON "performance_insights" ("status", "reviewed_at");
