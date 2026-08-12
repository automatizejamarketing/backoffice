# CLAUDE.md

Guidance for Claude Code when working directly inside `backoffice/`. This is the internal admin panel, one of three Next.js projects in the parent workspace. The sibling `../automatize-frontend/` is the user-facing SaaS.

## Project summary

Internal admin panel for AutomatizeJa / Automatize Marketing. It reads and writes the **same Postgres database** as `../automatize-frontend/`, so every schema change here must be mirrored there (see Database workflow below). Stack: Next.js 16 (App Router, React 19), Drizzle ORM, NextAuth v5 (Google-only), Tailwind v4 + shadcn/ui, `@tanstack/react-query`, `next-intl`, Stripe SDK, Vercel AI Gateway, Vercel Blob, postgres-js. Portuguese (pt-BR) is the default UI language. Path alias `@/*` maps to the project root.

Runs on **port 3006** so it can be developed alongside `automatize-frontend` (port 3000) against the same DB.

## Package manager

**Use `bun` only.** `packageManager` in `package.json` is `bun`, and the custom migrator is invoked as `bun scripts/...`. Do NOT run `npm install`, `npm run ...`, or `yarn`. If you see a `package-lock.json` in the tree, ignore it — `bun.lock` is the source of truth.

## Common commands

All commands assume cwd is `backoffice/`.

```bash
bun dev                  # Next.js dev server on port 3006
bun run build            # next build
bun run start            # next start -p 3006
bun run lint             # eslint (eslint-config-next flat config in eslint.config.mjs)
bun test                 # full suite — see "Running the tests" below
bun run db:generate      # drizzle-kit generate — creates a migration from schema.ts diff
bun run db:migrate       # CUSTOM — runs scripts/drizzle-migrate-with-baseline.ts (see below)
bun run db:push          # drizzle-kit push — DO NOT run against shared/prod DBs
bun run db:pull          # drizzle-kit introspect
bun run db:migrate:status # audita o journal contra o banco do APP_ENV atual
bun run db:migrate:repair # aplica o que o drizzle pulou (exige --yes)
```

There is no `test` script — `bun test` above is bun's built-in runner, not a `package.json` entry. Lint actually works (unlike the sibling frontend, which has no lint script).

### Running the tests

**A bare `bun test`, from `backoffice/`.** Nothing narrower runs the whole suite.

The suites are written against `node:test` and live in two places: `tests/` (the contract and parity suites mirrored with the frontend) and colocated `*.test.ts` next to the code under `lib/`. `bun test tests/` silently skips every colocated one — that is most of the suite.

Do NOT reach for `node --test`: this project has no `tsx` installed, so nothing executes the TypeScript. Bun's discovery skips dot-directories, which keeps the full tree copies under `.claude/worktrees/` out of the run — don't widen it with globs that reach into them.

### Why `db:migrate` is a custom script

`scripts/drizzle-migrate-with-baseline.ts` wraps `drizzle-kit migrate` with a baselining step:

1. Ensures `drizzle` schema and `drizzle.__drizzle_migrations` exist.
2. Reads the first entry in `lib/db/migrations/meta/_journal.json`, hashes its `.sql` file, and checks if that hash is already in `__drizzle_migrations`.
3. If the hash is missing **and** `public.users` already exists, it inserts a baseline row for migration 0000 with the journal's `when` timestamp, then runs `drizzle-kit migrate`.

This exists because the Postgres database was originally bootstrapped with `drizzle-kit push` (no migration history recorded). The first migration file `0000_misty_multiple_man.sql` would fail with "relation already exists" on any existing DB. Baselining tells Drizzle "pretend 0000 is already applied" so subsequent migrations (`0001_backoffice_audit_logs.sql`, `0002_...`, etc.) apply cleanly.

**Do not** replace `bun run db:migrate` with plain `bunx drizzle-kit migrate` — it will blow up on any real environment. If you add a new first-position migration (don't), update the script too.

### A marca d'água: como uma migration some sem erro

`drizzle-kit migrate` não guarda *quais* migrations rodaram — ele lê o
`max(created_at)` de `drizzle.__drizzle_migrations` e roda tudo que tiver `when`
**estritamente maior**. Uma marca d'água só.

Isso quebra aqui porque `backoffice` e `automatize-frontend` escrevem na MESMA
tabela de controle e cada branch escolhe seu `when` na mão. Se a sua branch pegar
um `when` abaixo de uma marca já levantada por outra branch — ou pelo repositório
irmão — sua migration nunca roda. Sem erro, sem aviso: o comando sai 0 dizendo
que não havia nada a aplicar.

Foi assim que `0044_meta_tracking_foundation` (`when=1793200000000`) nunca criou
as tabelas `meta_tracking_*` em produção — a marca já estava em `1793300000000`,
vinda do `0054_marketplace_fee_checkout_channel` do frontend. Em staging a ordem
das branches calhou de dar certo, então o bug só apareceu em produção, como 500
em `/api/meta-marketing/[accountId]/tracking-history`.

Por isso `db:migrate` **audita depois de migrar** (`lib/db/migration-audit.ts`) e
sai diferente de zero quando encontra entrada pulada cujo objeto não existe no
banco. O critério não é hash nem marca d'água: é abrir o `.sql`, extrair as
tabelas e colunas que ele cria e perguntar ao banco se estão lá. Para consertar o
que já foi pulado, `bun run db:migrate:repair --yes` aplica os arquivos e grava o
hash **com o `when` do próprio journal** — levantar a marca no reparo empurraria
para o limbo as migrations ainda pendentes do repositório irmão.

`tests/migration-journal.test.ts` barra a colisão nova de `when` entre os dois
repositórios; as sete que já existiam estão fixadas lá como dívida conhecida.

## Database workflow (CRITICAL)

The same Postgres DB backs both `backoffice/` and `../automatize-frontend/`. Two schema files describe it:

- `backoffice/lib/db/schema.ts`
- `../automatize-frontend/lib/db/schema.ts`

They are intentionally near-identical. Each project has its own `lib/db/migrations/` folder, but both write entries into the single `drizzle.__drizzle_migrations` table in the DB. Drift between the two schema files is a real bug that surfaces as runtime type errors in one app after a change was only made in the other.

**Rules for any schema change:**

1. Edit BOTH `schema.ts` files so they match.
2. Run `bun run db:generate` in the project that "owns" the change (typically the one whose feature needs it) to produce the SQL migration.
3. Escolha um `when` **maior que o último de AMBOS os journals** (o daqui e o de `../automatize-frontend/lib/db/migrations/meta/_journal.json`). Um `when` abaixo da marca d'água nunca roda — leia "A marca d'água" acima antes de reaproveitar número.
4. Run `bun run db:migrate` in that project to apply it — e confira a auditoria que ele imprime no fim. `db:migrate` só sai 0 quando nada foi pulado.
5. In the sibling project, either regenerate a no-op/empty migration or manually record the same migration so its journal stays in sync.
6. Rode `bun run db:migrate:status` **em cada ambiente** (`APP_ENV=local` é PRODUÇÃO nesta máquina; `.env.prod` e `.env.staging` apontam os dois para staging). Migrar um ambiente não migra os outros: não existe passo de migration no build da Vercel, tudo aqui é manual.
7. Prefer **additive, reversible** migrations. For type changes, use expand → backfill → contract across multiple deploys. Never drop columns/tables in the same migration that introduces a replacement.
8. Never run `bun run db:push` against shared or production databases — it bypasses the migrations table and corrupts the baseline contract that `scripts/drizzle-migrate-with-baseline.ts` depends on. `db:push` is for local scratch only.
9. Any destructive operation (drop column, drop table, change PK, `TRUNCATE`, data backfill that rewrites rows): **stop and ask the user to confirm** before generating or running it. Existing user data is not recoverable.

Current migrations in `lib/db/migrations/`: `0000_misty_multiple_man` (baseline), `0001_backoffice_audit_logs`, `0002_adset_edit_logs_backoffice_email`, `0003_polite_runaways`, `0004_old_maginty`, `0005_mean_nicolaos`, `0006_unique_carlie_cooper`. The `meta/_journal.json` is authoritative — do not hand-edit it.

The DB client in `lib/db/index.ts` uses `postgres-js` with `prepare: false` intentionally (prepared-statement reuse was returning stale rows on repeated identical UPDATEs — for example credit bumps). Don't flip it back to `prepare: true`.

## Architecture

### Next.js 16 middleware lives in `proxy.ts`

Next 16 renamed the middleware file. This project exports `proxy` (not `middleware`) from `proxy.ts` at the project root. **Do not create `middleware.ts`** — Next will report a conflict if both exist.

`proxy.ts` is simple but load-bearing:
- Skips `/api/auth/*` (NextAuth handlers).
- Calls `getToken` with `secureCookie: !isDevelopmentEnvironment`.
- No token + not on `/login` → redirect to `/login`.
- Has token + on `/login` → redirect to `/`.
- Matcher excludes `api/auth`, `login`, `_next/static`, `_next/image`, `favicon.ico`; everything else is gated.

Note the proxy does NOT check `ADMIN_EMAILS`. That check runs later in the NextAuth `signIn` callback and in the `(admin)` layout's `auth()` call. A user who somehow obtains a session cookie without being in the allowlist would still be bounced by the layout, but the funnel relies on both layers — don't remove either.

### NextAuth v5 + admin allowlist

Auth is configured in `app/(auth)/auth.ts` with `app/(auth)/auth.config.ts` as the edge-safe fragment:

- Single provider: **Google**. There is no credentials/password flow (unlike the frontend).
- The `signIn` callback calls `isAdminEmail(user.email)` from `lib/config.ts`. If false, NextAuth returns the string `/login?error=unauthorized`, which blocks the sign-in.
- `jwt` and `session` callbacks just propagate `user.id`. No Stripe/subscription refresh here (the frontend does that).
- Server actions for login/logout are in `app/(auth)/actions.ts` (`signInWithGoogle`, `signOutAction`).

**`lib/config.ts` is the admin allowlist.** Adding or removing an admin means editing the `ADMIN_EMAILS` array and deploying. Keep it in sync with reality — anyone not listed has zero admin access. Current entries at time of writing include LEG Holding / Infinite Growth / Layback Trade team members.

### Route groups

```
app/
  (auth)/
    auth.ts           # NextAuth config + handlers
    auth.config.ts    # edge-safe fragment (pages.signIn = /login)
    actions.ts        # signInWithGoogle, signOutAction server actions
    login/            # /login page
  (admin)/
    layout.tsx        # auth() guard → redirect("/login") if no session; renders sidebar + theme toggle
    page.tsx          # / — dashboard stat cards (getDashboardStats)
    users/            # /users — list + [id] detail; usage, credits, expirationDate control
    subscriptions/    # /subscriptions — Stripe subscription overview + [userId] detail
    posts/            # /posts — generated-post analytics; [postId], backoffice/ (admin-generated), user/
    marketing/        # /marketing — Meta Ads campaign inspector (select user → ad account → campaigns)
    affiliates/       # /affiliates — affiliate program admin; [id] detail; approve/reject/block APIs
  api/
    auth/             # NextAuth handlers (bypassed by proxy)
    users/            # search + [id] CRUD
    subscriptions/    # [userId] + list
    affiliates/       # approve, block, conversions, create, reactivate, reject, [id]
    meta-marketing/   # [accountId]/..., targeting/... — proxy to Meta Graph Marketing API
    geo/              # geo-targeting lookups
    posts/            # admin post queries
```

### Server-side patterns

- Admin pages are predominantly server components that call helpers from `lib/db/admin-queries.ts` (aggregate SQL via Drizzle) and pass serialized props to `"use client"` children. See `app/(admin)/posts/page.tsx` for the typical shape: `Promise.all` of queries, then `<Client initial... />`.
- Data mutations go through `app/api/*` route handlers (not server actions, except for auth). Client code uses fetch + `@tanstack/react-query`.
- Heavy list pages export `export const dynamic = "force-dynamic";` to avoid Vercel build timeouts (see `app/(admin)/users/page.tsx`). Keep that directive on any query-heavy admin page.
- `lib/db/index.ts` exports the singleton `db`. `lib/db/admin-queries.ts` is where cross-table aggregates live.
- `lib/backoffice/user-field-updates.ts` centralizes mutations to mutable user fields (credits, expirationDate) so they also write to `backofficeAuditLog`. Use it — do not UPDATE those fields inline in a route handler.
- `lib/meta-business/` wraps Graph API calls used by the `marketing/` page. `get-user-access-token.ts` reads from the `meta_business_accounts` table.
- `lib/stripe/index.ts` exports `stripe` as `Stripe | null` — it is `null` when `STRIPE_SECRET_KEY` is unset. Guard with `if (!stripe) return ...` before every call or the handler will NPE in environments without Stripe configured.

### Mirrored Meta sources — the frontend is authoritative

`lib/meta-business/duplicate.ts` is a **byte-identical mirror** of the frontend's copy. The admin
panel duplicates the same live campaigns the user dashboard does, so both must behave identically —
the two `duplicate.ts` files are compared byte-for-byte by
`../automatize-frontend/tests/meta-duplicate-parity.test.ts`.

Never edit this project's copy directly. Change the frontend's, then:

```bash
cd ../automatize-frontend && bun run sync:meta
```

and commit **both** projects in the same commit. `bun run sync:meta:check` reports drift without
writing. The file may carry code only the frontend calls (the ADR 0022/0023 AI-creation path) —
that is accepted: identical bytes are what keeps the two duplication engines from diverging.

`lib/meta-business/marketing/{creation,update}/`, `create-adset-in-existing-campaign.ts`,
`normalize-meta-error.ts` and `lib/meta-business/get-instagram-connected-page.ts` follow the same
frontend-first mirror policy, with import paths normalized (`@/lib/meta-business/marketing/` →
`@/lib/meta-business/`); see `meta-primitives-parity.test.ts`. `sync:meta` writes these too — it
applies the rewrite for you, so never hand-copy them.

`get-instagram-connected-page.ts` lives at this project's **flattened** `lib/meta-business/` root
(the frontend keeps it under `marketing/`) precisely because that is where the rewritten import
resolves. It exports more than this project calls; that dead code is the accepted price of the
mirror.

### shadcn/ui setup

`components.json` uses `style: "new-york"`, `baseColor: "neutral"`, `iconLibrary: "hugeicons"`. Aliases: `@/components`, `@/components/ui`, `@/lib`, `@/lib/utils`, `@/hooks`. Theme toggle in `components/theme-toggle.tsx`; `next-themes` is the provider.

## Environment variables

Environment files follow the same layout as `../automatize-frontend/`:

| File | Purpose |
|---|---|
| `.env.example` | Committed template (no secrets) |
| `.env.local` | Local dev (`APP_ENV=local`, default) |
| `.env.staging` | Staging/preview (`APP_ENV=staging`) |
| `.env.prod` | Production (`APP_ENV=prod`) |
| `.env` | Optional overrides loaded before the routed env file |

Load order is implemented in `lib/env/load-env.ts` and wired through `scripts/with-env.ts` for `dev`, `build`, and `start` scripts. Pull from Vercel with `bun run env:pull`.

Noteworthy variables:

- `POSTGRES_URL` — same physical DB as `automatize-frontend`. Toggle staging vs production in `.env.local` / `.env.staging` / `.env.prod`.
- `AUTH_SECRET` — backoffice's own NextAuth secret (different from the frontend's). Regenerate with `openssl rand -base64 32`.
- `AUTH_URL` / `NEXTAUTH_URL` / `NEXT_PUBLIC_APP_URL` — backoffice URL (magic links). Local dev: `http://localhost:3006`.
- `FRONTEND_URL` / `FRONTEND_APP_URL` — customer-facing frontend URL (trackable links, Mercado Pago). Not the backoffice URL.
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` — dedicated Google OAuth client for the backoffice (distinct from the frontend's client).
- `AI_GATEWAY_API_KEY` — Vercel AI Gateway key for AI post/caption generation (`app/api/posts/generate`). On Vercel deploys OIDC handles this automatically.
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob token (shared with frontend).
- `REDIS_URL` — Upstash Redis (shared).
- `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_AFFILIATE_COUPON_ID` — Stripe credentials.
- `BACKOFFICE_EMAIL_FROM`, `RESEND_API_KEY` — transactional email via Resend.
- Meta/Instagram vars — same values as the frontend; redirect URIs point at `automatizemarketing.com` (frontend-hosted callbacks).
- `GOOGLE_PLACES_API_KEY` — geo targeting search proxy.

Do not paste secrets from `.env*` files into commits or external docs.

## Things NOT to do

- Do NOT create `middleware.ts`. Use `proxy.ts` — see Next.js 16 note above.
- Do NOT replace `bun run db:migrate` with `drizzle-kit migrate`. The baselining step is required.
- Do NOT run `bun run db:push` against staging/production or any shared DB. It skips the migrations journal and breaks the baseline contract.
- Do NOT change `lib/db/schema.ts` without mirroring the edit in `../automatize-frontend/lib/db/schema.ts` and generating migrations in the owning project.
- Do NOT edit `lib/meta-business/duplicate.ts` here. Edit the frontend's copy and run `bun run sync:meta` there — this one is a byte-identical mirror.
- Do NOT edit the other mirrored Meta sources here either (`marketing/{creation,update}/*`, `marketing/create-adset-in-existing-campaign.ts`, `marketing/normalize-meta-error.ts`, `get-instagram-connected-page.ts`). Same rule: edit the frontend's copy, run `bun run sync:meta` there, commit both projects together.
- Do NOT use `npm`, `yarn`, or `pnpm`. Bun only.
- Do NOT add an email to `ADMIN_EMAILS` without the user explicitly approving it — it is an access-control list.
- Do NOT flip `postgres-js` back to `prepare: true` in `lib/db/index.ts`. It was set to `false` intentionally to fix a stale-row bug on repeated UPDATEs.
- Do NOT call `stripe` without a null guard; it is `null` when `STRIPE_SECRET_KEY` is unset.
- Do NOT remove the `export const dynamic = "force-dynamic"` directive from heavy admin pages — it prevents Vercel build timeouts.

## Agent skills

### Issue tracker

Issues e specs vivem como markdown local em `.scratch/<feature>/` neste repo. See `docs/agents/issue-tracker.md`.

### Triage labels

Vocabulário canônico padrão (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix) como linhas `Status:` nos tickets. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` na raiz + ADRs. See `docs/agents/domain.md`.
