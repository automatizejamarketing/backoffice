-- 0024_schema_snapshot_baseline
-- Intentional NO-OP. Snapshot baseline regularization (2026-06-09):
-- every schema object this snapshot describes already exists in staging
-- and production (applied out-of-band). This migration exists only so the
-- journal/snapshot chain matches reality and future `db:generate` diffs
-- start from a faithful state.
SELECT 1;
