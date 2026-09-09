# Ticket 02 notes

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
