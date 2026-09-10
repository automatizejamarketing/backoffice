# Ticket 24 notes

- The period contract is now source-scoped and identical in the frontend and backoffice. New or changed Instagram/site combinations do not expose a free period field while V02 evidence is open; an existing simple rule shows and preserves its parsed period instead of reusing it as a default for another source or criterion.
- Period evidence recorded on 2026-09-10 (all rows are currently blocked because no authenticated Ads Manager observation was available):

| Origin / criterion | Initial | Editable | Unit sent | Meta limits | Local validation | Historical fill | Evidence origin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Instagram / activity general (`all`) | unknown | unknown | days -> `retention_seconds` | unknown | 1-730 days | unknown | official Meta v25 engagement docs; no authenticated UI observation |
| Instagram / engagement (`engaged`) | unknown | unknown | days -> `retention_seconds` | unknown | 1-730 days | unknown | official Meta v25 engagement docs; no authenticated UI observation |
| Instagram / profile visits (`profile_visit`) | unknown | unknown | days -> `retention_seconds` | unknown | 1-730 days | unknown | official Meta v25 engagement docs; no authenticated UI observation |
| Instagram / messages (`messaged`) | unknown | unknown | days -> `retention_seconds` | unknown | 1-730 days | unknown | official Meta v25 engagement docs; no authenticated UI observation; regional availability remains unverified |
| Instagram / saved posts or ads (`saved`) | unknown | unknown | days -> `retention_seconds` | unknown | 1-730 days | unknown | official Meta v25 engagement docs; no authenticated UI observation |
| Website / all visitors (`visitors`) | unknown | unknown | days -> `retention_seconds` | unknown | no universal cap | unknown | official Meta v25 website docs; no authenticated UI observation; published 180/365 discrepancy remains open |
| Website / URL (`url`) | unknown | unknown | days -> `retention_seconds` | unknown | no universal cap | unknown | official Meta v25 website docs; no authenticated UI observation; published 180/365 discrepancy remains open |
| Website / observed event (`event`) | unknown | unknown | days -> `retention_seconds` | unknown | no universal cap | unknown | official Meta v25 website docs; no authenticated UI observation; published 180/365 discrepancy remains open |

- `prefill=true` is sent by the creation primitive, but it is not treated as evidence for an initial period or historical-fill behavior. No live Meta v25 mutation or authenticated Ads Manager exercise was possible headlessly; those remain controlled-environment follow-ups.

# Ticket 02 notes


# Ticket 17 notes

- The backoffice now exposes the same customer-list import journey as the frontend at `/api/meta-marketing/[accountId]/audiences/customer-file`, with operator/customer context, marketing RBAC, account ownership and token revalidation on every stage. It uses the shared public import service and durable store for CSV/XLSX create/add/remove/replace, reports, progress, recovery, expiry and sanitized history.
- The focused hermetic journey covers first-load creation, authorization revocation, stale preview, invalid-row consent, replacement correction, terms/declarations, context isolation, formula-safe expiring reports, cross-store audience conflict, byte cap, failed creation reconciliation and compromised lookalike-source availability: 10/10. No contacts or hashes enter operational history, LLM context, analytics or logs.
- `bun run build` passed. The headless environment had no authenticated Meta v25 customer-audience account, so controlled live capability/capacity and the final integrated AI paths remain pending. Existing focused removal failures are date-sensitive pre-existing failures caused by fixed previews predating the current clock.
- Operator metadata editing is sparse and preserves the external audience rule. The review re-reads the audience, account ownership and one paginated ad-set inventory before confirmation, exposes known include/exclude uses, lookalike dependencies and the absence of Meta's global reverse-use guarantee, then revalidates before writing.
- Confirmation carries the reviewed object, effective fields and impact snapshot. The server requires explicit `permission_for_actions.can_edit`, rechecks the reviewed metadata immediately before the sparse POST, and rejects mismatched command identities. A shared `meta_audience_commands` ledger coordinates pending, completed and uncertain commands across instances with a seven-day expiry; repeated confirmation is acknowledged as `alreadyApplied`, while uncertain responses expose an explicit reconciliation action without a blind retry. An authenticated Meta v25 account was not available headlessly, so live capability/permission behavior and the exact external-rule round trip still require the controlled exercise.

# Ticket 03 notes

- Meta Graph v25 deletion was covered with hermetic request stubs in the frontend; an authenticated Meta v25 account was not available in this headless session, so live capability and refusal evidence remain to be exercised in a controlled environment.
- The operator flow preserves campaign references and never removes or pauses campaigns/lookalikes automatically.

# Ticket 23 notes

- Audience reads now join the latest sanitized local import result to Meta's audience state and expose include, exclude, lookalike-source, Meta-processing, and import-result facts independently. The builds passed without an authenticated Meta v25 account, so live re-read and lookalike refusal still require a controlled exercise.

# Ticket 04 notes

- The operator interface and API support the same five Instagram criteria through the documented `ig_business` rule source, with explicit criterion-specific periods and hermetic contract coverage. The headless environment has no authenticated Meta v25 test profile, so creation/re-read evidence, Ads Manager initial periods, and regional availability (notably messages) still require a controlled live verification; no universal period is invented.
- Review/confirm/reconcile uses the durable ticket-02 command identity. It returns submitted identity/state, does not blindly retry uncertain operations, separates source access from activity and final availability, and guides missing-source configuration without provisioning assets or installing tracking.
- Only losslessly representable simple rules with permission are editable. Exclusions, aggregations, opaque/external rules, stale reviews, and insufficient permissions are refused without mutation; audience targeting, campaign changes, and arbitrary criterion combinations remain out of scope.

# Ticket 05 notes

- Website audiences use only accessible Pixels returned for the ad account. Source access, observed activity, source-specific WEB_ONLY stats, and final audience availability are separate facts; event names are listed only when the Pixel stats response reports them with positive volume, while stats errors remain unknown and never fall back to a generic catalogue.
- Visitors, URL filtering (`i_contains`), and observed-event rule shapes are compiled and parsed losslessly in both apps. Unknown conditions, unsupported operators, exclusions, and external rules are preserved/refused instead of being rewritten; the operator UI never installs Pixel/CAPI or changes campaign targeting.
- Review/confirm/reconcile follows the ticket-02 command ledger and records the pre-creation audience inventory, preventing an uncertain create from adopting a pre-existing same-name/same-rule audience. Period evidence is keyed by Pixel and criterion; the Meta v25 initial period, editability, limits, and historical-fill evidence remain open in the headless environment, so all website combinations show an explicit blocker rather than inventing 180/365 days or silently truncating. Rule parsing accepts a positive integer period and does not impose a universal 180-day ceiling.
- Update reconciliation compares the reviewed name, raw rule snapshot, and description, checks for duplicate target audiences, and refuses expired command identities before consulting the in-memory result cache.
- Review tokens expire seven days after review, before the durable claim, and source-event discovery uses the authenticated transport without putting the client access token in the URL.
