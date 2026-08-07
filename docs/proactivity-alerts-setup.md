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
