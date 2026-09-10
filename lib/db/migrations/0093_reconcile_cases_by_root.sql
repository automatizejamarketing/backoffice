CREATE TEMP TABLE product_reconciliation_case_roots ON COMMIT DROP AS
WITH RECURSIVE ancestry AS (
  SELECT o.id AS original_id, o.id AS current_id,
    CASE WHEN (o.attribution ->> 'order_bump_parent_order_id') ~ '^[0-9a-fA-F-]{36}$'
      THEN o.attribution ->> 'order_bump_parent_order_id' ELSE NULL END AS parent_id,
    0 AS depth
  FROM product_orders o
  UNION ALL
  SELECT a.original_id, parent.id,
    CASE WHEN (parent.attribution ->> 'order_bump_parent_order_id') ~ '^[0-9a-fA-F-]{36}$'
      THEN parent.attribution ->> 'order_bump_parent_order_id' ELSE NULL END,
    a.depth + 1
  FROM ancestry a
  JOIN product_orders parent ON parent.id::text = a.parent_id
  WHERE a.parent_id IS NOT NULL AND a.depth < 10
)
SELECT DISTINCT ON (original_id) original_id, current_id AS root_id
FROM ancestry WHERE parent_id IS NULL ORDER BY original_id, depth DESC;
CREATE TEMP TABLE product_reconciliation_case_groups ON COMMIT DROP AS
SELECT roots.root_id, c.kind, min(c.id) AS canonical_id,
  min(c.next_review_at) AS next_review_at,
  bool_or(c.status IN ('open', 'monitoring')) AS has_open,
  jsonb_agg(jsonb_build_object('caseId', c.id, 'orderId', c.order_id,
    'responsible', c.responsible, 'status', c.status,
    'nextReviewAt', c.next_review_at, 'evidence', c.evidence)
    ORDER BY c.created_at) AS merged_history
FROM product_reconciliation_cases c
JOIN product_reconciliation_case_roots roots ON roots.original_id = c.order_id
GROUP BY roots.root_id, c.kind;
DELETE FROM product_reconciliation_cases c
USING product_reconciliation_case_roots roots, product_reconciliation_case_groups groups
WHERE roots.original_id = c.order_id AND groups.root_id = roots.root_id
  AND groups.kind = c.kind AND c.id <> groups.canonical_id;--> statement-breakpoint
UPDATE product_reconciliation_cases c
SET order_id = groups.root_id,
  status = CASE WHEN groups.has_open THEN 'open' ELSE c.status END,
  next_review_at = groups.next_review_at,
  evidence = c.evidence || jsonb_build_object('merged_case_history', groups.merged_history),
  updated_at = now()
FROM product_reconciliation_case_groups groups
WHERE c.id = groups.canonical_id;
