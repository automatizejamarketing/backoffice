---
name: automatize-backoffice-impersonation
description: Log into the local Automatize backoffice as a specific team member (admin, comercial, consultor de marketing, financeiro) without Google OAuth, by minting the backoffice magic-session cookie for staging or production. Use when the user asks to impersonate someone in the backoffice, see the backoffice as Vinicius/Davi/Bernardo or any role, test permissions, or debug what a role can see.
---

# Automatize Backoffice Impersonation

Use this skill to see the backoffice exactly as a team member with a given papel de acesso and cargo comercial. It is for the local backoffice only; it never changes data.

Not to be confused with `automatize-user-impersonation`, which logs into the customer frontend as a customer.

## Safety Rules

- Only emails that exist in `backoffice_users` (or in `ADMIN_EMAILS` in `lib/config.ts`) get access; the script prints what the server will resolve before minting anything. If it prints "SEM ACESSO", stop and tell the user.
- Emails in `ADMIN_EMAILS` are admin even if the database says otherwise. To test a non-admin role for such an email, the email has to leave that list in code.
- Production requires `--confirm-prod`. It only reads `backoffice_users`; nothing is written.
- The local server must be running with the same env as the token (`AUTH_SECRET` is shared across envs, but the database is not): a staging token against a server pointed at prod resolves the role from prod.
- Never paste the token in the final response or into a browser the user did not ask for.

## Commands

Run from `backoffice/`.

```bash
bun run impersonate:user:staging -- --user pessoa@empresa.com
bun run impersonate:user:prod -- --user pessoa@empresa.com --confirm-prod
bun run impersonate:user:prod -- --user pessoa@empresa.com --confirm-prod --browser chrome
```

- Default (`--browser print`) prints the cookie and the `agent-browser` commands to install it. Use this for automated checks and screenshots.
- `--browser chrome` opens a dedicated Chrome profile already logged in at `--url` (default `https://automatize-backoffice.localhost:1355`). Use this when the user wants to click around themselves. The profile lives under `~/.automatize/backoffice-impersonation/`.

## Workflow

1. Confirm the environment. The local backoffice started by the Portless skill runs with `.env.prod`; use `--env prod --confirm-prod` to match it. If the server runs `dev:staging`, use staging.
2. Run the script. Read the "Acesso resolvido" line: it shows role, cargo and whether `ADMIN_EMAILS` overrides the database.
3. For automated verification, install the cookie with the printed `agent-browser` commands, then `snapshot -i` / `screenshot`. For the user, use `--browser chrome`.
4. Verify by what is visible: sidebar items and page access follow `ROLE_PERMISSIONS` in `lib/auth/rbac-core.ts` (`comercial` = painel, CRM, usuários em leitura, ativação).
5. To stop, clear the cookie (`agent-browser cookies clear`) or close the dedicated Chrome. Sessions expire on their own after the magic-session max age.

## Expected Database Refs

- staging: `wsbsnzgzqiehqnklzchm`
- prod: `hosjqwtfjjtmphchsuqf`

If the script prints a different Supabase ref, stop and ask the user before continuing.
