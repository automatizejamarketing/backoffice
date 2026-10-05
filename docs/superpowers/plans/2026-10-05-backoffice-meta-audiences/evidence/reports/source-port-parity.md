# Task 1 source-port parity

Result: **MATCH** for the requested source/text/hierarchy and workspace routing comparison. No functional or text-hierarchy discrepancy found in the two scoped files.

## Fixed inputs and method

- Backoffice: `D:/automatize-marketing/.worktrees/backoffice-audiences/backoffice`, commit `708289fe8c3f100d977cca6dff2d24e18e6bb54d`, files under `app/(admin)/marketing/audiences/`.
- Authoritative source: sibling `automatize-frontend`, commit `5942cc2e6ea1df41f4fa21681e35df326deaa546`, files under `app/app/(main)/marketing/audiences/`.
- Read committed contents using `git show`, with line numbers; compared only `audience-kind.ts` and `audience-workspace.tsx`. This is narrow source-port verification, not another code review or a browser/pixel check.

## Evidence

`audience-kind.ts` is byte-identical: `git rev-parse <commit>:<path>` returns blob `dd024fb01a88593c3fb69f48af8cf45ec0336e32` in both repositories. Thus create/edit unions (lines 5–6), type resolution and labels (8–15), edit-kind precedence (18–22), delivery/operation status fallback (25–30), and pt-BR count formatting (33–38) all match exactly. Instagram precedes website, member-manageable audiences route to customer editing, and unsupported editing falls back to metadata.

The four origins have identical order, titles, descriptions and icons in backoffice `audience-workspace.tsx:34–57` and source `audience-workspace.tsx:33–56`:

| Kind | Title | Description |
| --- | --- | --- |
| customer | Lista de clientes | Importe e-mails ou telefones de um arquivo CSV ou XLSX. |
| instagram | Instagram | Pessoas que interagiram com o perfil do negócio. |
| website | Site | Visitantes e eventos registrados pelo pixel. |
| lookalike | Público semelhante | Pessoas parecidas com um público que você já tem. |

Workspace copy matches at backoffice `audience-workspace.tsx:60–89` / source `audience-workspace.tsx:59–88`, including origin-first creation guidance, all create/edit titles, existing audience name/ID fallback, and the library-versus-campaign targeting explanation. Origin buttons retain the same title-over-description hierarchy and callback (`onSelectKind(source.kind)`) at backoffice `:119–127` / source `:116–124`. Workspace heading and supporting paragraph match at backoffice `:233–234` / source `:228–229`.

| Routing | Backoffice lines | Source lines | Preserved behavior |
| --- | --- | --- | --- |
| Edit Instagram/site | 137–157 | 134–154 | Same editor receives existing `state.audience`, account and `onSaved`. |
| Edit customer list | 158–168 | 155–165 | Same importer, selected audience ID, default operation `add`, `onChanged={onSaved}`. |
| Other edit kinds | 170–177 | 167–174 | Same metadata editor receives existing audience and `onSaved`. |
| Create Instagram/site/customer/lookalike | 180–203 | 177–200 | Same components and success callbacks; customer/lookalike receive the audience collection. |
| Back/close and surface | 265–301 | 256–287 | Same absent-state handling, create-only return to origins, inline back fallback, dialog close callback and accessible title/description. |

Source-preservation intent is retained within this scope: edits pass the original audience object/ID rather than reconstructing a rule, and creation keeps the same origin-to-editor dispatch. Added `userId` forwarding/context remount key, admin UI integration, container-relative layout, explicit close controls and dialog focus callbacks are legitimate backoffice adaptations; none changes the checked labels, hierarchy or create/edit destination. All editors retain `chrome="plain"`, as in source.

No product/test files, branches or index were modified; no suites, browser, database or Meta operations were run. This record covers the committed dispatch/copy contracts, not behavior inside the editors or runtime rendering.
