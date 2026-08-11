# Proactivity alerts — staging setup reference

## WhatsApp template (Meta)

Create **one** template in WhatsApp Manager (or Graph API). The app sends it when a client alert opens and `deliver_whatsapp` is enabled.

| Field | Value |
|-------|--------|
| **Name** | `proactivity_alert_v1` |
| **Language** | `pt_BR` |
| **Category** | `UTILITY` (prefer) or `MARKETING` if Meta rejects UTILITY |
| **Body** | see below |
| **Button** | URL — label `Abrir Automatize` → `https://app.automatizemarketing.com/app` |

### Body text (copy/paste)

```
Alerta Automatize: {{1}}

{{2}}

Abra o app para ver detalhes e agir.
```

### Variables

| Var | Meaning | Example |
|-----|---------|---------|
| `{{1}}` | Alert title (max ~60 chars, no markdown) | `Campanha parada há vários dias` |
| `{{2}}` | Short message (max ~200 chars, no markdown) | `A campanha Promo Delivery está pausada há 7 dias e já gerou resultados. Vale reativar?` |

### Optional env override

If you register a different name/language:

| Env | Default | Where |
|-----|---------|--------|
| `WHATSAPP_PROACTIVITY_TEMPLATE_NAME` | `proactivity_alert_v1` | automatize-frontend (Preview / staging) |
| `WHATSAPP_PROACTIVITY_TEMPLATE_LANG` | `pt_BR` | automatize-frontend (Preview / staging) |

Script (after Meta credentials are in env):

```bash
# automatize-frontend
APP_ENV=staging bun scripts/create-proactivity-whatsapp-template.ts
```

(Requires `META_WHATSAPP_ACCESS_TOKEN` + WABA id — same as nudge templates.)

---

## Slack Incoming Webhook (consultant alerts)

Used by backoffice when a playbook insight is newly created and the alert has **Slack** enabled.

### How to get `SLACK_PROACTIVITY_WEBHOOK_URL`

1. Open your Slack workspace in the browser.
2. Go to **[api.slack.com/apps](https://api.slack.com/apps)** → **Create New App** → **From scratch**  
   - Name e.g. `Automatize Proactivity`  
   - Pick the Automatize workspace.
3. In the app: **Incoming Webhooks** → turn **On**.
4. **Add New Webhook to Workspace** → choose the channel (e.g. `#marketing-alerts` or `#consultores`).
5. Copy the URL (`https://hooks.slack.com/services/T…/B…/…`).
6. Set it as env on the **backoffice** Vercel project:
   - Environment: **Preview**
   - Git branch: **staging** (same pattern as other staging secrets)
   - Name: `SLACK_PROACTIVITY_WEBHOOK_URL`
   - Value: the webhook URL

CLI example (paste the URL when prompted):

```bash
cd backoffice
vercel env add SLACK_PROACTIVITY_WEBHOOK_URL preview --scope automatizejamarketings-projects --git-branch staging
```

Or in Vercel UI: Project → Settings → Environment Variables → add for Preview + branch `staging`.

Redeploy backoffice staging after adding the env.

### Message shape

Posts a short text with client name, assigned consultant, campaign, evidence, and a link to `/users/{id}?tab=marketing`.

---

## Feature toggles (no code deploy)

After migration, open **Regras** in staging backoffice:

1. **Alertas de proatividade → Cliente** — enable rules + optional WhatsApp.
2. **Consultor** — enable rules + optional Slack.

In-app delivery is always on when the alert is **Ativo**. WhatsApp/Slack are extras.

---

## Opt-in Fake Meta scenario (`full_demo`)

Rare QA mode: selected user IDs skip live Meta Graph and evaluate a deterministic
`full_demo` fixture that exercises **all** client + consultant rules. Everyone else
keeps real Meta. Fake mode is **staging/local only** — `APP_ENV=prod` always forces
real Meta even if the env is accidentally present.

### Vercel setup (both projects)

Set the same comma-separated UUID allowlist on **Preview / staging** for:

- `automatize-frontend`
- `backoffice`

| Env | Example | Notes |
|-----|---------|--------|
| `META_FAKE_SCENARIO_USER_IDS` | `uuid-1,uuid-2` | Exact UUID match only |

```bash
# frontend Preview (staging branch)
cd ../automatize-frontend
vercel env add META_FAKE_SCENARIO_USER_IDS preview --scope automatizejamarketings-projects --git-branch staging

# backoffice Preview (staging branch)
cd ../backoffice
vercel env add META_FAKE_SCENARIO_USER_IDS preview --scope automatizejamarketings-projects --git-branch staging
```

Redeploy **both** staging deployments after changing the allowlist.

Do **not** set this env on Production.

### Manual triggers (CRON_SECRET)

Client (frontend staging):

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://<frontend-staging-host>/api/cron-job/proactive-signals/fake-run?userId=<UUID>"
```

Consultant (backoffice staging):

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://<backoffice-staging-host>/api/cron-job/business/playbook-insights/seed-mock?userId=<UUID>"
```

Both require the user to be in `META_FAKE_SCENARIO_USER_IDS`.

### Expected results

- Client: new/open rows in `proactive_signals` for the seven client rule IDs; UI surfaces them in-app.
- Consultant: new/open rows in `performance_insights` for the five `playbook.*` rule IDs; visible in Carteira / user Marketing tab.
- Deliveries for fake users are recorded as `skipped` with `reason_code=fake_meta_scenario` — **no** WhatsApp or Slack provider call.

### Reset / cleanup

Fake runs reuse normal reconciliation/cooldowns. To re-demo the same user:

1. Dismiss/resolve open signals/insights in the UI, or wait for cooldown expiry; or
2. Remove the UUID from the allowlist, redeploy, and (optionally) clean rows manually if you need a blank slate.

Do not run destructive SQL against production for demos.

### Staging smoke

```bash
cd backoffice
APP_ENV=staging bun scripts/with-env.ts bun scripts/smoke-proactivity-staging.ts
```

Prints allowlist state and verifies the consultant `full_demo` fixture against DB thresholds.

---

## Client WhatsApp QA override

To exercise client rules without messaging real customers, set on **automatize-frontend**:

| Env | Purpose |
|-----|---------|
| `NEXT_PUBLIC_PROACTIVE_SIGNALS_ENABLED=true` | Turn detection cron / post-connect on |
| `WHATSAPP_PROACTIVITY_OVERRIDE_TO=47992664694` | Redirect every proactivity WhatsApp to this number (55 added if missing) |

While the override is set, no customer phone is used. Fake Meta allowlisted users also send to the override (instead of skipping). Remove the override (and redeploy) before real customer WhatsApp delivery.

Prefer a single-user `fake-run` or one targeted Meta user first — a full cron with WhatsApp enabled on many rules can flood the override phone.

---

## Production rollout: consultant Slack only

Goal: ship consultant playbook + Slack in production while client proactive detection stays off.

1. On **automatize-frontend Production**, set `NEXT_PUBLIC_PROACTIVE_SIGNALS_ENABLED=false` and redeploy.
2. Confirm frontend production cron returns `{ skipped: true, reason: "proactive_signals_disabled" }`.
3. On **backoffice Production**, set `SLACK_PROACTIVITY_WEBHOOK_URL`, enable Slack only on the desired consultant rules in **Regras**, redeploy backoffice.
4. Run one consultant playbook refresh for a real Meta user → expect one in-app insight + exactly one Slack delivery; refresh again → delivery dedup skips a second message.
5. Existing open client `proactive_signals` may remain visible; the kill switch stops new client evaluation and WhatsApp sends. Do not wipe them for this rollout.
6. Later: set `NEXT_PUBLIC_PROACTIVE_SIGNALS_ENABLED=true` on frontend Production and redeploy when client alerts are accepted.
