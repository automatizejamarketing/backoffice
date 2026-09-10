# Ticket 31 notes

- Os textos e nomes acessíveis das opções avançadas de públicos da campanha com IA foram normalizados nos dois aplicativos. A verificação de codificação agora percorre também as árvores de IA, seus endpoints e testes de feature do frontend e do backoffice.
- O ambiente headless não possui uma conta Meta v25 autenticada nem permite abrir manualmente os dois aplicativos; a apresentação visual e a validação ao vivo das permissões continuam exigindo ensaio controlado. Nenhuma mutação autenticada foi tentada.

# Ticket 33 notes

- A página independente de Públicos e a biblioteca aberta nas opções avançadas da campanha com IA agora renderizam o mesmo `AudienceLibraryManager`, incluindo a jornada completa de importação de listas, com o contexto de cliente/conta do operador isolado e sem callback de seleção para a campanha.
- O ambiente headless não possui uma conta Meta v25 autenticada nem permite abrir manualmente os dois aplicativos; a apresentação visual e a validação ao vivo das permissões continuam exigindo ensaio controlado. Nenhuma mutação autenticada foi tentada.

# Ticket 29 notes

- On 2026-09-10, `tests/audience-integration.test.ts` passed in both applications with a headless integrated journey: it creates fresh Instagram and website audiences through the unified primitive, creates and loads a customer list through the public import service, forms one lookalike from each origin, rereads the library, and applies the audiences to AI targeting derivations. The test also proves OR-minus-exclusions, expansion disabling, and functional preservation when options are undefined; no campaign route is called.
- The backoffice confirmation paths now use the frontend's unified audience-creation contract, including the lookalike and customer-list shapes. Whole-percent validation tolerates IEEE-754 decimal representations such as 7% and 14%.

| Check | Version/context | Source/observation | Sanitized outcome | Status |
| --- | --- | --- | --- | --- |
| V01 - access/capabilities | Simulated Graph/Marketing API v25.0, both applications | `customer-list-import-journey`, `audience-selection-guard`, metadata and integration tests | revocation, cross-customer/account access, and explicit capability denials refuse without contact material | hermetic pass; live permissions/terms pending |
| V02 - Instagram/website | v25.0; no authenticated Ads Manager account | official documentation and Ticket 24 matrix; UI not observable headlessly | five Instagram criteria and three website criteria remain `unknown` for period evidence; new combinations are blocked | pending; do not claim live support |
| V03 - targeting | Simulated Graph v25.0 | inclusion/exclusion, demographic-limit, fallback, and integration tests | OR-minus-exclusions, per-type expansion disabling, and effective restoration are preserved when options are absent | hermetic pass; effective Meta read-back pending |
| V04 - imports/sessions | Simulated Graph v25.0; shared SQLite | CSV/XLSX journey, removal, replacement, and recovery tests | batches/receipts/states and conflicts use shared coordination; sanitized batches contain no email/phone | hermetic pass; live session/capacity pending |
| V05 - lookalike/management | Simulated Graph v25.0 | integration creates fresh origins and lookalikes; exclusion/metadata/delete tests | every origin type is consulted, whole percentages are sent, and no object/campaign is cascaded | hermetic pass; live eligibility pending |
| V06 - capacity/temporary data | local limits of 100,000 records/20 MiB, 24-hour retention | CSV/XLSX ceiling/overflow, formula, expiry, and multi-batch tests | no truncation; reports expire and sanitized history survives cleanup | hermetic pass; real volume/time measurement pending |
| V07 - integration/regression | frontend + backoffice, simulated Graph v25.0 | tracer in both worktrees, schema parity, client boundary, and builds | public contracts, release switch, and routes compile in both apps; stale test drift was corrected | hermetic pass; authenticated validation and frontend full-runner baseline pending |

- The existing operational switch remains reversible and on by default for marketing-enabled customers: `CUSTOMER_AUDIENCE_IMPORTS_ENABLED=false` stops only the import journey and preserves the library, campaigns, Meta audiences, and history. There is no pilot, new plan, or extra charge.
- The headless environment has no authenticated Meta v25 account and does not allow manual opening of the two applications. Controlled Ads Manager confirmation, capabilities/terms, real limits, and rule round-trips remain pending; this is not an implementation block.
- The backoffice repository-wide suite passed 1,090/1,090. The frontend repository-wide Bun discovery still reports unrelated baseline `postgresClient` import failures and Bun nested `describe`/`test` runner errors; the ticket-focused audience, parity, migration, and modified customer-file checks pass.

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
