# WhatsApp Template Delivery Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Meta delivery callbacks for every official outbound WhatsApp template and expose read-only global and per-user monitoring in the Backoffice.

**Architecture:** The `frontend` remains the write-side owner: it adds two additive tables, wraps official template sends, and persists signed Meta status callbacks. The `backoffice` mirrors the schema and supplies server-side filtered queries plus two read-only views. Existing onboarding and billing delivery tables remain the source of eligibility and deduplication.

**Tech Stack:** TypeScript, Next.js 16 App Router, Drizzle ORM, PostgreSQL, WhatsApp Cloud API, Bun tests, Tailwind CSS, shadcn/ui.

## Global Constraints

- Track only official outbound templates; exclude inbound messages, Mat/Eve free text, and manual support.
- Store no raw Meta payload, message body, duplicated phone number, token, or request headers.
- `whatsapp:view` is granted only to `admin` and `dev` in this version.
- Historical rows may be labeled `sent`/`failed`, but old `delivered` or `read` states must never be invented.
- Monitoring failures must not make an accepted customer message retry and duplicate.
- Existing onboarding and billing tables keep all eligibility and deduplication responsibilities.
- Reuse the current Backoffice tokens and components; no new dependency or visual re-theme.
- Do not run a build command.
- Keep the known unrelated baseline failures out of scope: `agent/lib/whatsapp-hitl.test.ts` in `frontend` and `lib/mercadopago/pix-errors.test.ts` in `backoffice`.

## UI Direction

- **Visual thesis:** a quiet operational telemetry surface using the existing neutral Backoffice palette, with delivery state carried by a compact connected status rail rather than decorative cards.
- **Content plan:** global workspace = heading, filters, five operational counts, delivery table; user detail = account context already present in the hub plus a chronological template history.
- **Interaction thesis:** URL-backed filters and pagination remain predictable; linked users and rows get clear hover/focus affordances; the status rail communicates progression without ornamental animation.
- **Signature element:** a restrained `sent → delivered → read` rail with connected dots; failure and historical-untracked states branch into explicit badges and text.

---

### Task 1: Add the frontend persistence schema and pure status model

**Files:**
- Modify: `frontend/lib/db/schema.ts`
- Create: `frontend/lib/db/migrations/0046_whatsapp_template_delivery_tracking.sql`
- Modify: `frontend/lib/db/migrations/meta/_journal.json`
- Create: `frontend/lib/meta-business/whatsapp/delivery-model.ts`
- Create: `frontend/lib/meta-business/whatsapp/delivery-model.test.ts`
- Modify: `frontend/lib/meta-business/whatsapp/types.ts`

**Interfaces:**
- Produces: `WhatsappTemplateDeliveryStatus`, `WhatsappTemplateStatusEventInput`, `parseWhatsappTemplateStatusEvents(payload)`, `deriveWhatsappTemplateDeliveryState(current, events)`, and the two Drizzle tables.
- Consumes: the existing WhatsApp webhook payload and `users.id`.

- [ ] **Step 1: Write failing model tests**

Cover a valid `sent/delivered/read` payload, ignored unknown status, failed-event sanitization, duplicate inputs, and an older event that must not downgrade `read`:

```ts
const events = parseWhatsappTemplateStatusEvents(payload);
expect(events.map((event) => event.status)).toEqual(["sent", "delivered", "read"]);
expect(deriveWhatsappTemplateDeliveryState(currentRead, [olderDelivered]).currentStatus)
  .toBe("read");
expect(events[0].failureDetail).not.toContain("Bearer");
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test lib/meta-business/whatsapp/delivery-model.test.ts`
Expected: FAIL because `delivery-model.ts` does not exist.

- [ ] **Step 3: Implement the pure model**

Define the accepted provider statuses and explicit output shape:

```ts
export type WhatsappTemplateDeliveryStatus =
  | "queued" | "sent" | "delivered" | "read" | "failed" | "deleted";

export type WhatsappTemplateStatusEventInput = {
  eventKey: string;
  providerMessageId: string;
  status: Exclude<WhatsappTemplateDeliveryStatus, "queued">;
  providerStatusAt: Date;
  failureCode: string | null;
  failureDetail: string | null;
};
```

Parse only recognized statuses, convert Meta Unix seconds to `Date`, cap sanitized errors at 500 characters, and derive state using provider timestamp with tie precedence `deleted > failed > read > delivered > sent`.

- [ ] **Step 4: Add the additive migration and Drizzle schema**

Create the additive tables with these exact persisted fields:

```sql
CREATE TABLE "whatsapp_template_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "source" varchar(64) NOT NULL,
  "source_delivery_id" varchar(255) NOT NULL,
  "template_name" varchar(255) NOT NULL,
  "language_code" varchar(16) NOT NULL DEFAULT 'pt_BR',
  "provider_message_id" varchar(255),
  "current_status" varchar(32) NOT NULL DEFAULT 'queued',
  "current_status_at" timestamp,
  "accepted_at" timestamp,
  "delivered_at" timestamp,
  "read_at" timestamp,
  "failed_at" timestamp,
  "deleted_at" timestamp,
  "failure_code" varchar(64),
  "failure_detail" text,
  "historical_status_untracked" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_template_deliveries_source_unique"
    UNIQUE("source", "source_delivery_id"),
  CONSTRAINT "whatsapp_template_deliveries_provider_message_unique"
    UNIQUE("provider_message_id")
);

CREATE TABLE "whatsapp_template_status_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "delivery_id" uuid REFERENCES "whatsapp_template_deliveries"("id") ON DELETE CASCADE,
  "event_key" varchar(512) NOT NULL,
  "provider_message_id" varchar(255) NOT NULL,
  "provider_status" varchar(32) NOT NULL,
  "provider_status_at" timestamp NOT NULL,
  "failure_code" varchar(64),
  "failure_detail" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_template_status_events_event_key_unique" UNIQUE("event_key")
);
```

Add indexes on deliveries `(user_id, created_at)`, `(template_name, created_at)`, `(current_status, created_at)`, and `provider_message_id`, plus events `(provider_message_id, provider_status_at)`. PostgreSQL uniqueness on nullable `provider_message_id` permits multiple queued rows.

Add migration journal entry `idx: 46`, `tag: "0046_whatsapp_template_delivery_tracking"`.

- [ ] **Step 5: Run focused tests and schema checks**

Run:

```bash
bun test lib/meta-business/whatsapp/delivery-model.test.ts
bunx tsc --noEmit
git diff --check
```

Expected: model tests PASS; typecheck has no new error; diff check is clean.

- [ ] **Step 6: Commit frontend schema/model**

```bash
git add lib/db/schema.ts lib/db/migrations/0046_whatsapp_template_delivery_tracking.sql lib/db/migrations/meta/_journal.json lib/meta-business/whatsapp/delivery-model.ts lib/meta-business/whatsapp/delivery-model.test.ts lib/meta-business/whatsapp/types.ts
git commit -m "feat(whatsapp): add template delivery tracking schema"
```

### Task 2: Add the delivery repository and tracked template sender

**Files:**
- Create: `frontend/lib/meta-business/whatsapp/delivery-repository.ts`
- Create: `frontend/lib/meta-business/whatsapp/tracked-template.ts`
- Create: `frontend/lib/meta-business/whatsapp/tracked-template.test.ts`
- Modify: `frontend/lib/meta-business/whatsapp/client.ts`

**Interfaces:**
- Consumes: Task 1 tables and model; existing raw `sendWhatsappTemplateMessage`.
- Produces:

```ts
sendTrackedWhatsappTemplateMessage(params: {
  userId: string;
  source: "onboarding_notification" | "billing_notification";
  sourceDeliveryId: string;
  to: string;
  templateName: string;
  languageCode: string;
  components?: WhatsappTemplateComponent[];
}): Promise<{ messageId: string | null }>;

persistWhatsappTemplateStatusEvents(events: WhatsappTemplateStatusEventInput[]): Promise<void>;
```

- [ ] **Step 1: Write failing tracked-sender tests**

Inject repository and provider dependencies and assert:

```ts
expect(calls).toEqual(["start", "send", "accepted"]);
```

Also assert provider rejection records sanitized `failed` and rethrows, while `start`/`accepted` monitoring failures do not prevent or retry an accepted provider send.

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test lib/meta-business/whatsapp/tracked-template.test.ts`
Expected: FAIL because the tracked sender does not exist.

- [ ] **Step 3: Implement repository operations**

Add operations to:

- insert or reset the central delivery to `queued` by `(source, sourceDeliveryId)`;
- mark provider acceptance with `wamid`, `acceptedAt`, and `sent`;
- mark provider rejection with sanitized code/detail;
- insert webhook events idempotently;
- associate orphan events and rederive the delivery state whenever a `wamid` becomes available.

`reconcileWhatsappTemplateDelivery(providerMessageId)` must update all matching orphan events and derive the current row from the full ordered event set.

- [ ] **Step 4: Implement the tracked sender**

Keep the raw provider client unchanged for non-template/free-text callers. The tracked sender must call it internally. Monitoring writes are best effort around the provider call:

```ts
await repository.start(params).catch(logTrackingFailure);
try {
  const result = await providerSend(params);
  await repository.markAccepted(params, result.messageId).catch(logTrackingFailure);
  return result;
} catch (error) {
  await repository.markFailed(params, error).catch(logTrackingFailure);
  throw error;
}
```

Logs include only source, source delivery ID, template name, and sanitized error—never `to`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
bun test lib/meta-business/whatsapp/tracked-template.test.ts lib/meta-business/whatsapp/client.test.ts
bunx tsc --noEmit
git diff --check
```

- [ ] **Step 6: Commit the repository and sender**

```bash
git add lib/meta-business/whatsapp/delivery-repository.ts lib/meta-business/whatsapp/tracked-template.ts lib/meta-business/whatsapp/tracked-template.test.ts lib/meta-business/whatsapp/client.ts
git commit -m "feat(whatsapp): track official template sends"
```

### Task 3: Persist signed Meta status callbacks

**Files:**
- Modify: `frontend/agent/lib/whatsapp-ingress.ts`
- Create: `frontend/agent/lib/whatsapp-ingress-status.test.ts`

**Interfaces:**
- Consumes: Task 1 parser and Task 2 `persistWhatsappTemplateStatusEvents`.
- Produces: webhook behavior that commits status events before returning `200`.

- [ ] **Step 1: Write failing ingress tests**

Test a signed status-only payload and assert the persistence dependency receives the parsed event and no inbound message is dispatched. Test persistence rejection and expect `500`, preserving signature rejection as `401`.

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test agent/lib/whatsapp-ingress-status.test.ts`
Expected: FAIL because `handleWhatsappWebhookIngress` ignores `statuses`.

- [ ] **Step 3: Extend the ingress handler**

After signature verification and JSON parsing:

```ts
const statusEvents = parseWhatsappTemplateStatusEvents(payload);
if (statusEvents.length > 0) {
  try {
    await persistWhatsappTemplateStatusEvents(statusEvents);
  } catch {
    return new Response("status persistence failed", { status: 500 });
  }
}
```

Then continue the existing inbound queue path. Do not log raw payload or provider error content.

- [ ] **Step 4: Run focused ingress tests**

Run:

```bash
bun test agent/lib/whatsapp-ingress-status.test.ts agent/lib/whatsapp-ingress-queue-core.test.ts
bunx tsc --noEmit
git diff --check
```

- [ ] **Step 5: Commit webhook capture**

```bash
git add agent/lib/whatsapp-ingress.ts agent/lib/whatsapp-ingress-status.test.ts
git commit -m "feat(whatsapp): persist delivery status webhooks"
```

### Task 4: Route every official template through tracked sending

**Files:**
- Modify: `frontend/workflows/signup-whatsapp-nudge.ts`
- Modify: `frontend/workflows/trial-campaign-nudge.ts`
- Modify: `frontend/app/api/cron-job/billing/mercadopago-renewal/route.ts`
- Modify: `frontend/lib/mercadopago/payment-confirmation.ts`
- Modify: `frontend/lib/mercadopago/payment-confirmation-server.ts`
- Modify: `frontend/lib/mercadopago/payment-confirmation.test.ts`
- Modify: `frontend/scripts/backfill-whatsapp-nudges.ts`
- Create: `frontend/lib/meta-business/whatsapp/official-template-sources.test.ts`

**Interfaces:**
- Consumes: Task 2 tracked sender.
- Produces: coverage for all five currently approved official templates.

- [ ] **Step 1: Write failing source-coverage tests**

Assert the official source mapping contains exactly:

```ts
[
  "signup_nudge_15m_v2",
  "signup_nudge_1d_v2",
  "trial_onboarding_nudge_30m_v1",
  "pix_renovacao_v2",
  "pix_pagamento_confirmado_v1",
]
```

Update payment confirmation tests so its injected sender receives both the claimed context and template request.

- [ ] **Step 2: Run tests and verify the new expectations fail**

Run: `bun test lib/meta-business/whatsapp/official-template-sources.test.ts lib/mercadopago/payment-confirmation.test.ts`

- [ ] **Step 3: Replace raw template calls**

Use these stable source keys:

- onboarding: `source="onboarding_notification"`, `sourceDeliveryId="${userId}:${notificationType}"`;
- billing: `source="billing_notification"`, `sourceDeliveryId=billingNotificationDelivery.id`.

For PIX confirmation, change the injected sender to:

```ts
send: (
  context: PixPaymentConfirmationContext,
  params: WhatsappTemplateSendParams,
) => Promise<{ messageId: string | null }>;
```

and add `userId` to the confirmation context so the server adapter can call the tracked sender.

- [ ] **Step 4: Run all affected flow tests**

Run:

```bash
bun test lib/onboarding/whatsapp-nudge-eligibility.test.ts lib/onboarding/whatsapp-nudge-template-definitions.test.ts lib/mercadopago/renewal-whatsapp.test.ts lib/mercadopago/payment-confirmation.test.ts lib/meta-business/whatsapp/official-template-sources.test.ts
bunx tsc --noEmit
git diff --check
```

- [ ] **Step 5: Commit call-site migration**

```bash
git add workflows/signup-whatsapp-nudge.ts workflows/trial-campaign-nudge.ts app/api/cron-job/billing/mercadopago-renewal/route.ts lib/mercadopago/payment-confirmation.ts lib/mercadopago/payment-confirmation-server.ts lib/mercadopago/payment-confirmation.test.ts scripts/backfill-whatsapp-nudges.ts lib/meta-business/whatsapp/official-template-sources.test.ts
git commit -m "feat(whatsapp): track all official template flows"
```

### Task 5: Add historical import and deletion maintenance

**Files:**
- Create: `frontend/scripts/backfill-whatsapp-template-deliveries.ts`
- Create: `frontend/lib/meta-business/whatsapp/historical-import.ts`
- Create: `frontend/lib/meta-business/whatsapp/historical-import.test.ts`
- Modify: `frontend/scripts/delete-user.ts`

**Interfaces:**
- Consumes: Task 1 tables and current `onboarding_notification_deliveries`/`billing_notification_deliveries`.
- Produces: idempotent `--dry-run`/`--apply` import with per-template counts.

- [ ] **Step 1: Write failing import-policy tests**

Test mappings from onboarding notification types and billing notification types to the five template names. Assert sent rows become `historicalStatusUntracked=true`, failed rows keep no invented acceptance timestamp, and repeated source IDs are deduplicated.

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test lib/meta-business/whatsapp/historical-import.test.ts`

- [ ] **Step 3: Implement pure mapping and paginated script**

The script defaults to dry-run and only writes with `--apply`. Process source rows in pages of 100, print counts by source/template/status, and insert with `onConflictDoNothing` on `(source, source_delivery_id)`.

Do not send WhatsApp messages from this script.

- [ ] **Step 4: Update user deletion order**

Delete `whatsapp_template_status_events` before `whatsapp_template_deliveries`, then continue the current customer-data deletion sequence.

- [ ] **Step 5: Run focused tests and a non-production dry-run help check**

Run:

```bash
bun test lib/meta-business/whatsapp/historical-import.test.ts
bun scripts/backfill-whatsapp-template-deliveries.ts --help
bunx tsc --noEmit
git diff --check
```

- [ ] **Step 6: Commit historical tooling**

```bash
git add scripts/backfill-whatsapp-template-deliveries.ts lib/meta-business/whatsapp/historical-import.ts lib/meta-business/whatsapp/historical-import.test.ts scripts/delete-user.ts
git commit -m "feat(whatsapp): add historical delivery import"
```

### Task 6: Mirror schema, add Backoffice RBAC, filters, and queries

**Files:**
- Modify: `backoffice/lib/db/schema.ts`
- Modify: `backoffice/lib/auth/rbac-core.ts`
- Modify: `backoffice/lib/auth/rbac-core.test.ts`
- Create: `backoffice/lib/backoffice/whatsapp-history-model.ts`
- Create: `backoffice/lib/backoffice/whatsapp-history-model.test.ts`
- Create: `backoffice/lib/db/whatsapp-template-queries.ts`

**Interfaces:**
- Produces:

```ts
normalizeWhatsappHistoryFilters(raw): WhatsappHistoryFilters;
getWhatsappTemplateHistory(filters): Promise<{
  items: WhatsappTemplateHistoryItem[];
  total: number;
  summary: WhatsappTemplateHistorySummary;
  templates: string[];
}>;
getUserWhatsappTemplateHistory(userId: string): Promise<WhatsappTemplateHistoryItem[]>;
```

- Consumes: shared database tables created by Task 1.

- [ ] **Step 1: Write failing RBAC and model tests**

Assert `admin/dev` have `whatsapp:view`; consultant/finance do not. Test default seven-day date window, page normalization, recognized statuses, and metric semantics where `readAt` also counts as delivered.

- [ ] **Step 2: Run tests and verify they fail**

Run: `bun test lib/auth/rbac-core.test.ts lib/backoffice/whatsapp-history-model.test.ts`

- [ ] **Step 3: Mirror schema and implement permission**

Mirror both tables in the Backoffice Drizzle schema with these fields:

```ts
whatsappTemplateDelivery: id, userId, source, sourceDeliveryId, templateName,
languageCode, providerMessageId, currentStatus, currentStatusAt, acceptedAt,
deliveredAt, readAt, failedAt, deletedAt, failureCode, failureDetail,
historicalStatusUntracked, createdAt, updatedAt;

whatsappTemplateStatusEvent: id, deliveryId, eventKey, providerMessageId,
providerStatus, providerStatusAt, failureCode, failureDetail, createdAt;
```

Do not create a Backoffice migration because the `frontend` migration owns the shared database. Extend `BackofficePermission` with `whatsapp:view`, grant it to `admin` and `dev`, and extend `USER_HUB_TAB_VALUES` with `whatsapp` without adding it to consultant tabs.

- [ ] **Step 4: Implement filter/model helpers and server queries**

Use São Paulo calendar boundaries, default seven days, fixed page size 50, and database-side filtering/pagination. Join `users` only for existing name/e-mail display. Aggregate metrics across the full filtered date range, not only the visible page.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
bun test lib/auth/rbac-core.test.ts lib/backoffice/whatsapp-history-model.test.ts
bunx tsc --noEmit
git diff --check
```

- [ ] **Step 6: Commit Backoffice data layer**

```bash
git add lib/db/schema.ts lib/auth/rbac-core.ts lib/auth/rbac-core.test.ts lib/backoffice/whatsapp-history-model.ts lib/backoffice/whatsapp-history-model.test.ts lib/db/whatsapp-template-queries.ts
git commit -m "feat(whatsapp): add backoffice delivery data layer"
```

### Task 7: Build the global WhatsApp monitoring page

**Files:**
- Create: `backoffice/app/(admin)/whatsapp/page.tsx`
- Create: `backoffice/components/whatsapp-delivery-status.tsx`
- Modify: `backoffice/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: Task 6 `getWhatsappTemplateHistory`, filters, labels, and `whatsapp:view`.
- Produces: `/whatsapp` read-only operational page and reusable status rail.

- [ ] **Step 1: Add the server route and permission boundary**

Call `requirePagePermission("whatsapp:view")` before querying data. Keep filters in `searchParams` (`range`, `from`, `to`, `template`, `status`, `q`, `page`).

- [ ] **Step 2: Implement the working surface**

Build, in order:

1. utility heading and description;
2. URL-backed filter row;
3. five restrained metrics;
4. horizontally scrollable real table;
5. previous/next pagination preserving filters.

Use existing `Card`, `Badge`, `Table`, `Button`, and `Input`. Add the sidebar item with `MessageCircle` and `whatsapp:view`.

- [ ] **Step 3: Implement the signature status rail**

`WhatsappDeliveryStatus` renders connected `sent`, `delivered`, and `read` nodes with text labels. Use existing semantic colors, visible focus for linked content, `aria-label` describing the current state, and a separate destructive badge for failure. Historical rows display “Status posterior não rastreado”.

- [ ] **Step 4: Verify static behavior**

Run:

```bash
bunx eslint 'app/(admin)/whatsapp/page.tsx' components/whatsapp-delivery-status.tsx components/app-sidebar.tsx
bunx tsc --noEmit
git diff --check
```

Do not run UI-only tests or a build.

- [ ] **Step 5: Commit the global page**

```bash
git add 'app/(admin)/whatsapp/page.tsx' components/whatsapp-delivery-status.tsx components/app-sidebar.tsx
git commit -m "feat(whatsapp): add delivery monitoring page"
```

### Task 8: Add WhatsApp history to user detail

**Files:**
- Modify: `backoffice/app/(admin)/users/[id]/user-hub-page.tsx`

**Interfaces:**
- Consumes: Task 6 per-user query and Task 7 status component.
- Produces: `?tab=whatsapp` history restricted to `whatsapp:view`.

- [ ] **Step 1: Add the tab and conditional query**

Add `{ value: "whatsapp", label: "WhatsApp", icon: MessageCircle }` to `TAB_CONFIG`. Query history only when the active tab is `whatsapp` and the actor has `whatsapp:view`.

- [ ] **Step 2: Render the per-user history**

Render a compact chronological table/list with friendly and technical template names, source label, shared status rail, each timestamp, sanitized failure, and historical marker. Preserve the existing user-hub header and mobile tab navigation.

- [ ] **Step 3: Verify access and code quality**

Run:

```bash
bun test lib/auth/rbac-core.test.ts lib/backoffice/whatsapp-history-model.test.ts
bunx eslint 'app/(admin)/users/[id]/user-hub-page.tsx'
bunx tsc --noEmit
git diff --check
```

- [ ] **Step 4: Commit user detail**

```bash
git add 'app/(admin)/users/[id]/user-hub-page.tsx'
git commit -m "feat(whatsapp): show template history per user"
```

### Task 9: Cross-repository verification and rollout preparation

**Files:**
- Modify only if verification exposes defects in files already listed above.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: two clean branches ready for staging, with migration/backfill commands documented in the handoff.

- [ ] **Step 1: Run frontend focused suite**

```bash
bun test lib/meta-business/whatsapp/delivery-model.test.ts lib/meta-business/whatsapp/tracked-template.test.ts agent/lib/whatsapp-ingress-status.test.ts lib/meta-business/whatsapp/official-template-sources.test.ts lib/meta-business/whatsapp/historical-import.test.ts lib/mercadopago/payment-confirmation.test.ts
bunx tsc --noEmit
git diff --check
```

- [ ] **Step 2: Run Backoffice focused suite**

```bash
bun test lib/auth/rbac-core.test.ts lib/backoffice/whatsapp-history-model.test.ts
bunx tsc --noEmit
git diff --check
```

- [ ] **Step 3: Review privacy and scope mechanically**

Search the new files and confirm no raw payload, phone, token, authorization header, Mat response, or manual support message is persisted:

```bash
rg -n "rawBody|authorization|access_token|phone|message body|Mat|Eve" lib/meta-business/whatsapp scripts/backfill-whatsapp-template-deliveries.ts
```

Every match must be a type/input use or explicit exclusion, never a persisted monitoring column or log field.

- [ ] **Step 4: Record known baseline failures**

Run the full suites only to compare with baseline if time permits. Do not fix or include unrelated failures in these branches.

- [ ] **Step 5: Prepare staging handoff**

Report:

- frontend and Backoffice commit SHAs;
- migration `0046_whatsapp_template_delivery_tracking`;
- staging migration command used by the existing deployment process;
- dry-run command `APP_ENV=staging bun scripts/with-env.ts bun scripts/backfill-whatsapp-template-deliveries.ts --dry-run`;
- that no real message, production backfill, or production deployment was executed without a separate operational confirmation.
