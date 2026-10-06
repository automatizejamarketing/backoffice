import { getCampaignPricing } from "./whatsapp-campaign-pricing";
import "server-only";
import { sql } from "drizzle-orm";
import { db, postgresClient as pg } from "@/lib/db";
import { ADMIN_EMAILS } from "@/lib/config";
import { CUSTOMER_BASE_TRIAL_EXCLUDED_EMAILS } from "./customer-base-status";
import { assertSchedule, campaignInput, campaignPhone } from "./whatsapp-campaign-core";
import { findCampaignTemplate } from "./whatsapp-meta";

export type CampaignRow = {
  id: string; title: string; template_name: string; body: string;
  state: "draft" | "scheduled" | "paused" | "completed";
  dispatch_mode: "manual" | "scheduled";
  scheduled_at: Date | null; unit_cost_micros: number; budget_micros: string;
  created_at: Date; updated_at: Date; revision: string; created_by: string; updated_by: string;
  total: number; sent: number; delivered: number; read: number; failed: number;
  pending: number; unknown: number; excluded: number;
};
export type CampaignAudience = { id: string; name: string | null; email: string; phone: string };

// Same "never started" cohort as signup nudges, additionally removing commercial
// conversations and the team's known internal accounts. Rechecked before sending.
const eligibleSql = `u.expiration_date is null
  and not exists (select 1 from subscriptions s where s.user_id = u.id)
  and not exists (select 1 from credit_transactions t where t.user_id = u.id and t.type = 'trial_grant')
  and not exists (select 1 from backoffice_users b where lower(b.email) = lower(u.email))
  and not exists (select 1 from crm_leads l where l.user_id = u.id and l.commercial_status <> 'novo_lead')
  and not exists (select 1 from conversations c join conversation_events e on e.conversation_id = c.id
    where c.channel = 'whatsapp' and e.type = 'message.received'
      and (c.user_id = u.id or regexp_replace(c.phone_e164, '[^0-9]', '', 'g') =
        case when length(regexp_replace(u.phone, '[^0-9]', '', 'g')) <= 11
          then '55' || regexp_replace(u.phone, '[^0-9]', '', 'g') else regexp_replace(u.phone, '[^0-9]', '', 'g') end))`;
// Compare the recipient identity across accounts, not only the selected user.
function phoneSql(column: string) {
  const digits = `regexp_replace(${column}, '[^0-9]', '', 'g')`;
  return `case when length(${digits}) <= 11 then '55' || ${digits} else ${digits} end`;
}
const peerEligibleSql = eligibleSql.replaceAll('u.', 'peer.');
const excludedEmails = [...ADMIN_EMAILS, ...CUSTOMER_BASE_TRIAL_EXCLUDED_EMAILS].map(v => v.toLowerCase());

export async function campaignAudience(userId?: string): Promise<CampaignAudience[]> {
  const rows = await pg.unsafe<{id: string; name: string | null; email: string; phone: string | null}[]>(
    `select u.id,u.name,u.email,u.phone from users u where ${eligibleSql}
     and not (lower(u.email) = any($1::text[]))
     and not exists (select 1 from users peer
       where ${phoneSql('peer.phone')} = ${phoneSql('u.phone')}
         and (not (${peerEligibleSql}) or lower(peer.email) = any($1::text[]))) ${userId ? "and u.id = $2::uuid" : ""}
     order by u.created_at asc nulls last,u.id limit 10000`,
    userId ? [excludedEmails, userId] : [excludedEmails],
  );
  const phones = new Set<string>();
  return rows.flatMap(row => {
    const phone = campaignPhone(row.phone);
    if (!phone || phones.has(phone)) return [];
    phones.add(phone);
    return [{ ...row, phone }];
  });
}

export async function getCampaign(id: string) {
  const [row] = await pg<CampaignRow[]>`select *,updated_at::text as revision from whatsapp_campaigns where id = ${id}`;
  if (!row) throw new Error("Campanha não encontrada.");
  return row;
}

export async function listCampaigns() {
  const rows = await pg<CampaignRow[]>`
    select c.*, count(r.id)::int as total,
      count(*) filter(where r.state='sent')::int as sent,
      count(*) filter(where d.delivered_at is not null or d.read_at is not null)::int as delivered,
      count(*) filter(where d.read_at is not null)::int as read,
      count(*) filter(where r.state='failed' or d.failed_at is not null)::int as failed,
      count(*) filter(where r.state='pending')::int as pending,
      count(*) filter(where r.state in ('unknown','sending'))::int as unknown,
      count(*) filter(where r.state in ('skipped','excluded'))::int as excluded
    from whatsapp_campaigns c left join whatsapp_campaign_recipients r on r.campaign_id=c.id
    left join whatsapp_template_deliveries d on d.id=r.delivery_id
    group by c.id order by c.created_at desc limit 100`;
  return rows;
}

export async function saveCampaign(id: string, input: unknown, actor: string) {
  const value = campaignInput.parse(input);
  const rows = await pg`insert into whatsapp_campaigns
    (id,title,template_name,body,unit_cost_micros,budget_micros,created_by,updated_by)
    values (${id},${value.title},${value.templateName},${value.body},${value.unitCostMicros},${value.budgetMicros},${actor},${actor})
    on conflict (id) do update set title=excluded.title, template_name=excluded.template_name,
      body=excluded.body,unit_cost_micros=excluded.unit_cost_micros,budget_micros=excluded.budget_micros,
      updated_by=excluded.updated_by,updated_at=now()
    where whatsapp_campaigns.state='draft'
    returning id`;
  if (!rows.length) throw new Error("Somente rascunhos podem ser editados.");
  return getCampaign(id);
}

export async function scheduleCampaign(id: string, requestedDate: Date | null, userIds: string[], actor: string) {
  const campaign = await getCampaign(id);
  const template = await findCampaignTemplate(campaign.template_name);
  if (template?.category !== "MARKETING") throw new Error("Esta campanha exige um template de Marketing.");
  const pricing = await getCampaignPricing();
  if (campaign.unit_cost_micros !== pricing.unitCostMicros) throw new Error("A tarifa da Meta mudou. Salve o rascunho novamente para atualizar a estimativa antes de confirmar.");
  const audience = (await campaignAudience()).filter(u => userIds.includes(u.id));
  if (audience.length !== new Set(userIds).size) throw new Error("O público mudou. Atualize a seleção antes de agendar.");
  // Null means an explicit manual release; the server chooses its start time.
  const date = requestedDate ?? new Date();
  const dispatchMode = requestedDate ? "scheduled" : "manual";
  assertSchedule({ scheduledAt: date, now: new Date(), dispatchMode, count: audience.length,
    unitCostMicros: campaign.unit_cost_micros, budgetMicros: Number(campaign.budget_micros),
    templateStatus: template?.status ?? "MISSING", templateBody: template?.components.find(c => c.type === "BODY")?.text ?? "", body: campaign.body });
  await db.transaction(async tx => {
    // Compare revision after network calls; serialize concurrent scheduling/edit.
    const claimed = await tx.execute(sql`update whatsapp_campaigns set state='scheduled',dispatch_mode=${dispatchMode},scheduled_at=${date.toISOString()},updated_by=${actor},updated_at=now()
      where id=${id} and state='draft' and updated_at=${campaign.revision}::timestamptz returning id`);
    if (!claimed.length) throw new Error("A campanha mudou. Atualize a página.");
    for (let offset = 0; offset < audience.length; offset += 100) {
      const entries = audience.slice(offset, offset + 100).map(u => sql`(${id},${u.id},${u.phone})`);
      await tx.execute(sql`insert into whatsapp_campaign_recipients (campaign_id,user_id,phone) values ${sql.join(entries,sql`,`)}`);
    }
  });
}

export async function setCampaignPaused(id: string, paused: boolean, actor: string) {
  if (!paused) {
    const campaign = await getCampaign(id);
    const template = await findCampaignTemplate(campaign.template_name);
    if (template?.status !== "APPROVED" || template.components.find(c => c.type === "BODY")?.text !== campaign.body)
      throw new Error("O template precisa continuar aprovado e com o mesmo texto.");
  }
  const rows = await pg`update whatsapp_campaigns set state=${paused ? 'paused' : 'scheduled'},updated_by=${actor},updated_at=now()
    where id=${id} and state=${paused ? 'scheduled' : 'paused'} returning id`;
  if (!rows.length) throw new Error("Essa campanha não pode mudar de estado agora.");
}

export async function campaignRecipients(id: string) {
  return pg`select r.id,r.user_id,r.phone,r.state,r.reason,u.name,u.email,d.current_status,d.delivered_at,d.read_at
    from whatsapp_campaign_recipients r join users u on u.id=r.user_id
    left join whatsapp_template_deliveries d on d.id=r.delivery_id
    where r.campaign_id=${id} order by r.updated_at desc limit 1000`;
}

export async function excludeCampaignRecipient(id: string, recipientId: string, actor: string) {
  const rows = await pg`update whatsapp_campaign_recipients set state='excluded',reason=${`Retirado por ${actor}`},updated_at=now()
    where id=${recipientId} and campaign_id=${id} and state='pending' returning id`;
  if (!rows.length) throw new Error("Só é possível retirar contatos que ainda estão na fila.");
}
