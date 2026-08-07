# Expert Platform Fee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Charge 5.49% plus R$0.39 on new paid acquisitions for each expert, configured per expert and snapshotted per order, while Automatize-owned products pay no platform fee.

**Architecture:** Store percentage and fixed fee on `expert_profiles`, resolve them once when an order is created, and snapshot both values on `product_orders` under financial model v3. Settlement uses only order snapshots. Backoffice expert forms own the configuration; product forms no longer expose a fee override.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle ORM, PostgreSQL, Zod, Bun test, Tailwind/shadcn.

## Global Constraints

- Expert default fee is exactly 549 basis points plus 39 centavos.
- Automatize-owned products resolve zero platform fee and retain gross minus provider cost.
- Existing orders and payments keep their historical snapshots and calculations.
- Provider costs never reduce expert or coproducer receivables.
- Product-level fee override is ignored for new acquisitions and removed from the UI.
- Do not run a build command.

## UI Direction

- **Visual thesis:** preserve the existing dark operational workspace and make the fee a compact, auditable part of expert identity rather than a separate settings surface.
- **Content plan:** show the effective fee in the Experts table; edit percentage, fixed amount, and a R$100 simulation inside the Expert dialog; show inheritance-only helper copy in Product dialogs.
- **Interaction thesis:** use the existing button loading state, keep the dialog open on errors, and update the fee preview immediately without ornamental motion.

---

### Task 1: Shared schema and migration

**Files:**
- Create: `backoffice/lib/db/migrations/0040_expert_platform_fee.sql`
- Modify: `backoffice/lib/db/migrations/meta/_journal.json`
- Modify: `backoffice/lib/db/schema.ts`
- Create: `frontend/lib/db/migrations/0046_expert_platform_fee.sql`
- Modify: `frontend/lib/db/migrations/meta/_journal.json`
- Modify: `frontend/lib/db/schema.ts`

**Interfaces:**
- Produces: `expertProfile.platformFeeBasisPoints: number`, `expertProfile.platformFeeFixedCentavos: number`, `productOrder.platformFeeFixedCentavos: number | null`, and financial model `platform_fee_coproduction_v3`.
- Preserves: v1/v2 order constraints with `platformFeeFixedCentavos = null`.

- [ ] **Step 1: Add a schema contract test that expects the new expert and order properties**

Add a focused Bun test that imports both Drizzle tables and asserts the property names exist:

```ts
assert.ok(expertProfile.platformFeeBasisPoints);
assert.ok(expertProfile.platformFeeFixedCentavos);
assert.ok(productOrder.platformFeeFixedCentavos);
```

- [ ] **Step 2: Run the contract test and verify it fails because the properties do not exist**

Run: `bun test lib/products/expert-platform-fee-schema.test.ts`

- [ ] **Step 3: Add equivalent migrations and schema fields in both repositories**

The migration adds defaults to Experts and a nullable fixed-fee snapshot to orders. Extend the order consistency constraint with v3: paid expert orders use valid snapshots; Automatize orders use `0` and `0`; historical models retain their existing rules. Do not update historical `product_orders`.

- [ ] **Step 4: Run the schema contract tests and relevant existing tests**

Run in each repository: `bun test lib/products/expert-platform-fee-schema.test.ts`

- [ ] **Step 5: Commit the schema in each repository**

```bash
git add lib/db/schema.ts lib/db/migrations lib/products/expert-platform-fee-schema.test.ts
git commit -m "feat(products): store expert platform fee snapshots"
```

### Task 2: Fee resolution and financial calculation

**Files:**
- Modify: `frontend/lib/products/financial-model.test.ts`
- Modify: `frontend/lib/products/financial-model.ts`

**Interfaces:**
- Produces: `resolveProductPlatformFee({ ownerType, expertFeeBasisPoints, expertFeeFixedCentavos }): { basisPoints: number; fixedCentavos: number }`.
- Extends: `calculateProductFinancialBreakdown` with `platformFeeFixedCentavos`.

- [ ] **Step 1: Replace the override test with failing owner-resolution tests**

Cover an expert resolving `{ basisPoints: 549, fixedCentavos: 39 }`, an Automatize product resolving zeros, and an expert missing either configuration throwing an explicit error.

- [ ] **Step 2: Add failing calculation tests**

Assert:

```ts
// Expert sale: R$100.00
platformFeeGrossCentavos === 588
coproductionBaseCentavos === 9412

// Automatize sale: R$100.00, provider cost R$3.98
platformFeeGrossCentavos === 0
automatizeTotalNetRevenueCentavos === 9602

// Very low price caps fee at gross
calculate(...grossAmountCentavos: 10...).platformFeeGrossCentavos === 10
```

- [ ] **Step 3: Run the tests and verify the expected failures**

Run: `bun test lib/products/financial-model.test.ts`

- [ ] **Step 4: Implement the minimal resolver and fixed-fee calculation**

For expert products calculate `min(gross, round(gross * basisPoints / 10000) + fixedCentavos)`. For Automatize products return a zero fee. Free products always return zero.

- [ ] **Step 5: Run the focused test and confirm all cases pass**

Run: `bun test lib/products/financial-model.test.ts`

- [ ] **Step 6: Commit the domain calculation**

```bash
git add lib/products/financial-model.ts lib/products/financial-model.test.ts
git commit -m "feat(products): calculate expert percentage and fixed fee"
```

### Task 3: Order creation and settlement snapshots

**Files:**
- Modify: `frontend/lib/products/queries.ts`
- Modify: `frontend/lib/products/settle-order.ts`
- Create: `frontend/lib/products/platform-fee-resolution.test.ts`
- Modify: any existing checkout/settlement test fixture that constructs a Product Order.

**Interfaces:**
- Consumes: `resolveProductPlatformFee` and v3 schema fields.
- Produces: new orders with `financialModel = "platform_fee_coproduction_v3"`, `platformFeeBasisPoints`, and `platformFeeFixedCentavos`.

- [ ] **Step 1: Write failing resolution tests around order inputs**

Use a small exported pure helper to prove that Expert products snapshot the owner's current fee, Automatize products snapshot zeros, and `platformFeeBasisPointsOverride` is never consulted.

- [ ] **Step 2: Run the test and verify it fails before the helper exists**

Run: `bun test lib/products/platform-fee-resolution.test.ts`

- [ ] **Step 3: Load the owner Expert fee during acquisition creation**

Extend the product query to select the owner's fee fields. Remove the global financial-setting lookup and product override resolution from the new-order path. Insert both snapshots with model v3.

- [ ] **Step 4: Make settlement read the fixed-fee snapshot only for v3**

Pass `order.platformFeeFixedCentavos ?? 0` into the calculation. Keep v1/v2 calculations unchanged and never query the current Expert.

- [ ] **Step 5: Run financial, resolution, checkout, and settlement tests**

Run: `bun test lib/products/financial-model.test.ts lib/products/platform-fee-resolution.test.ts`

- [ ] **Step 6: Commit the snapshot flow**

```bash
git add lib/products/queries.ts lib/products/settle-order.ts lib/products/*test.ts
git commit -m "feat(products): snapshot expert fee on acquisition"
```

### Task 4: Expert admin input and persistence

**Files:**
- Modify: `backoffice/lib/products/expert-input.ts`
- Modify: `backoffice/lib/products/expert-input.test.ts`
- Modify: `backoffice/lib/db/product-queries.ts`
- Modify: `backoffice/app/api/products/admin/experts/route.ts`
- Modify: `backoffice/app/api/products/admin/experts/[id]/route.ts`

**Interfaces:**
- Consumes API fields: `platformFeePercent: number`, `platformFeeFixedCentavos: number`.
- Produces DB fields: `platformFeeBasisPoints`, `platformFeeFixedCentavos`.

- [ ] **Step 1: Write failing parser tests**

Assert that `5.49` becomes `549`, `39` remains `39`, defaults are applied on expert creation, and values below zero or percentage above 100 are rejected.

- [ ] **Step 2: Run the parser test and verify it fails on the new fields**

Run: `bun test lib/products/expert-input.test.ts`

- [ ] **Step 3: Extend the parser and create/update queries**

Persist both components on create and update. Return both fields from expert list queries. PATCH must preserve the existing value only when a field is intentionally omitted by a non-upgraded client.

- [ ] **Step 4: Run parser and admin input tests**

Run: `bun test lib/products/expert-input.test.ts lib/products/admin-input.test.ts`

- [ ] **Step 5: Commit Expert API behavior**

```bash
git add lib/products/expert-input* lib/db/product-queries.ts app/api/products/admin/experts
git commit -m "feat(products): manage platform fee per expert"
```

### Task 5: Remove product/global fee mutation paths

**Files:**
- Modify: `backoffice/lib/products/admin-input.test.ts`
- Modify: `backoffice/lib/products/admin-input.ts`
- Modify: `backoffice/lib/db/product-queries.ts`
- Modify: `backoffice/app/(admin)/products/products-admin-workspace.tsx`

**Interfaces:**
- Product API no longer persists `platformFeeBasisPointsOverride`.
- Old clients may send the field, but it has no effect on new orders.

- [ ] **Step 1: Change the product parser test to prove the legacy override is ignored**

Pass `platformFeePercentOverride: 8` and assert the parsed persistence object has no override field.

- [ ] **Step 2: Run the test and verify it fails because the override is still returned**

Run: `bun test lib/products/admin-input.test.ts`

- [ ] **Step 3: Remove override writes from product create/update and publish payloads**

Keep the physical DB column for rollback compatibility, but do not mutate it. Remove the global settings dialog, request, state, and product custom-fee controls from the workspace.

- [ ] **Step 4: Run product input tests**

Run: `bun test lib/products/admin-input.test.ts`

- [ ] **Step 5: Commit removal of obsolete controls**

```bash
git add lib/products/admin-input* lib/db/product-queries.ts app/'(admin)'/products/products-admin-workspace.tsx
git commit -m "refactor(products): remove per-product platform fee"
```

### Task 6: Expert fee UI

**Files:**
- Modify: `backoffice/app/(admin)/products/products-admin-workspace.tsx`
- Create: `backoffice/lib/products/expert-fee-display.ts`
- Create: `backoffice/lib/products/expert-fee-display.test.ts`

**Interfaces:**
- Produces formatting helpers for percentage, fixed BRL value, and R$100 preview.

- [ ] **Step 1: Write failing formatter tests**

Assert `549/39` renders `5,49% + R$0,39` and preview `Em uma venda de R$100,00, a taxa é R$5,88.`.

- [ ] **Step 2: Run the formatter test and verify it fails before implementation**

Run: `bun test lib/products/expert-fee-display.test.ts`

- [ ] **Step 3: Implement formatters and add Expert form controls**

Use the existing percentage and BRL masks. New Expert forms start at `5,49%` and `R$0,39`; edit forms load persisted values. Display the preview below the fields and the effective fee in the Experts table.

- [ ] **Step 4: Add inheritance copy to Product forms**

For Expert products show `Este produto usa a taxa configurada no expert proprietário.` For Automatize products show `Produto próprio: sem taxa da plataforma.`

- [ ] **Step 5: Run logic tests and lint only touched files**

Run: `bun test lib/products/expert-fee-display.test.ts lib/products/expert-input.test.ts lib/products/admin-input.test.ts`

Run: `bunx eslint app/'(admin)'/products/products-admin-workspace.tsx lib/products/expert-fee-display.ts`

- [ ] **Step 6: Commit the UI**

```bash
git add app/'(admin)'/products/products-admin-workspace.tsx lib/products/expert-fee-display*
git commit -m "feat(products): edit and display expert platform fee"
```

### Task 7: Compatibility verification and handoff

**Files:**
- Modify: `backoffice/docs/superpowers/specs/2026-08-07-expert-platform-fee-design.md` only if implementation revealed a factual mismatch.

- [ ] **Step 1: Run all focused Backoffice tests**

Run: `bun test lib/products/expert-platform-fee-schema.test.ts lib/products/expert-input.test.ts lib/products/admin-input.test.ts lib/products/expert-fee-display.test.ts lib/products/financial-settings.test.ts lib/backoffice/finance-payments.test.ts`

- [ ] **Step 2: Run all focused Frontend tests**

Run: `bun test lib/products/expert-platform-fee-schema.test.ts lib/products/financial-model.test.ts lib/products/platform-fee-resolution.test.ts`

- [ ] **Step 3: Run type checking without build**

Run in each repository: `bunx tsc --noEmit`

Pre-existing unrelated failures must be reported separately from feature failures.

- [ ] **Step 4: Inspect final migrations and diffs**

Confirm no historical order update, no active product override lookup, and no platform fee on Automatize-owned products.

- [ ] **Step 5: Start local Backoffice against the selected environment and inspect desktop/mobile UI**

Verify expert create/edit defaults, table display, save loading state, and product inheritance copy. Do not mutate production data during visual verification.

- [ ] **Step 6: Prepare release handoff**

Report branch names, commits, migrations, focused test results, typecheck status, and the exact local URL. Do not deploy until separately authorized.
