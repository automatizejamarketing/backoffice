# Ticket 02 notes

- Operator metadata editing is sparse and preserves the external audience rule. The review re-reads the audience, account ownership and one paginated ad-set inventory before confirmation, exposes known include/exclude uses, lookalike dependencies and the absence of Meta's global reverse-use guarantee, then revalidates before writing.
- Confirmation carries the reviewed object, effective fields and impact snapshot. The server requires explicit `permission_for_actions.can_edit`, rechecks the reviewed metadata immediately before the sparse POST, and rejects mismatched command identities. A shared `meta_audience_commands` ledger coordinates pending, completed and uncertain commands across instances with a seven-day expiry; repeated confirmation is acknowledged as `alreadyApplied`, while uncertain responses expose an explicit reconciliation action without a blind retry. An authenticated Meta v25 account was not available headlessly, so live capability/permission behavior and the exact external-rule round trip still require the controlled exercise.

# Ticket 03 notes

- Meta Graph v25 deletion was covered with hermetic request stubs in the frontend; an authenticated Meta v25 account was not available in this headless session, so live capability and refusal evidence remain to be exercised in a controlled environment.
- The operator flow preserves campaign references and never removes or pauses campaigns/lookalikes automatically.

# Ticket 23 notes

- Audience reads now join the latest sanitized local import result to Meta's audience state and expose include, exclude, lookalike-source, Meta-processing, and import-result facts independently. The builds passed without an authenticated Meta v25 account, so live re-read and lookalike refusal still require a controlled exercise.
