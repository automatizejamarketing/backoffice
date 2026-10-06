import { getCampaignPricing } from "./whatsapp-campaign-pricing";
import "server-only";
import { sql } from "drizzle-orm";
import { db, postgresClient as pg } from "@/lib/db";
import { ADMIN_EMAILS } from "@/lib/config";
import { CUSTOMER_BASE_TRIAL_EXCLUDED_EMAILS } from "./customer-base-status";
import { assertSchedule, campaignInput, campaignPhone } from "./whatsapp-campaign-core";
import { audienceFiltersSchema, DEFAULT_AUDIENCE_FILTERS, type AudienceFilters, type AudienceStatus } from "./whatsapp-campaign-audience";
import { findCampaignTemplate } from "./whatsapp-meta";

export type CampaignRow = {
  id: string; title: string; template_name: string; body: string; audience_filters: AudienceFilters;
  state: "draft" | "scheduled" | "paused" | "completed";
  dispatch_mode: "manual" | "scheduled";
  scheduled_at: Date | null; unit_cost_micros: number; budget_micros: string;
  created_at: Date; updated_at: Date; revision: string; created_by: string; updated_by: string;
  total: number; sent: number; delivered: number; read: number; failed: number;
  pending: number; unknown: number; excluded: number;
};
export type CampaignAudience = { id: string; name: string | null; email: string; phone: string;
  created_at: Date | null; expiration_date: Date | null; account_status: AudienceStatus };

function phoneSql(column: string) {
  const digits = `regexp_replace(${column}, '[^0-9]', '', 'g')`;
  return `case when length(${digits}) <= 11 then '55' || ${digits} else ${digits} end`;
}
const excludedEmails = [...ADMIN_EMAILS, ...CUSTOMER_BASE_TRIAL_EXCLUDED_EMAILS].map(v => v.toLowerCase());
// Classification uses paid subscription history, never subscription existence as proof of payment.
const classifiedUsersSql = `select u.*,
  case when exists (select 1 from payments p where p.user_id=u.id and p.status='succeeded'
    and p.amount>0 and (p.purpose is null or p.purpose in ('subscription','legacy_renewal')))
    then case when u.expiration_date <= now() then 'churn' when u.expiration_date > now() then 'paying' else 'other' end
    when u.expiration_date > now() then 'trial_active'
    when u.expiration_date <= now() then 'trial_expired'
    when not exists(select 1 from subscriptions s where s.user_id=u.id)
      and not exists(select 1 from credit_transactions t where t.user_id=u.id and t.type='trial_grant') then 'never_started'
    else 'other' end as account_status,
  (exists(select 1 from crm_leads l where l.user_id=u.id and l.commercial_status<>'novo_lead')
    or exists(select 1 from conversations c join conversation_events e on e.conversation_id=c.id
      where c.channel='whatsapp' and e.type='message.received' and (c.user_id=u.id or ${phoneSql('c.phone_e164')}=${phoneSql('u.phone')}))) as contacted,
  (lower(u.email)=any($1::text[]) or exists(select 1 from backoffice_users b where lower(b.email)=lower(u.email))) as internal
  from users u`;

export async function campaignAudience(userId?: string, input: AudienceFilters = DEFAULT_AUDIENCE_FILTERS): Promise<CampaignAudience[]> {
  const filters=audienceFiltersSchema.parse(input);
  const rows=await pg.unsafe<CampaignAudience[]>(`with classified as (${classifiedUsersSql})
    select u.id,u.name,u.email,u.phone,u.created_at,u.expiration_date,u.account_status from classified u
    where not u.internal and u.account_status=any($2::text[]) and (not $3::boolean or not u.contacted)
    and ($4::date is null or u.created_at >= $4::date::timestamp at time zone 'America/Sao_Paulo')
    and ($5::date is null or u.created_at < ($5::date+1)::timestamp at time zone 'America/Sao_Paulo')
    and ($6::date is null or u.expiration_date >= $6::date::timestamp at time zone 'America/Sao_Paulo')
    and ($7::date is null or u.expiration_date < ($7::date+1)::timestamp at time zone 'America/Sao_Paulo')
    and not exists(select 1 from classified peer where ${phoneSql('peer.phone')}=${phoneSql('u.phone')}
      and (peer.internal or not(peer.account_status=any($2::text[])) or ($3::boolean and peer.contacted)))
    and ($8::uuid is null or u.id=$8::uuid)
    order by u.created_at asc nulls last,u.id limit 10001`,
    [excludedEmails,filters.statuses,filters.excludeContacted,filters.createdFrom||null,filters.createdTo||null,filters.expiresFrom||null,filters.expiresTo||null,userId||null]);
  if(rows.length>10000)throw new Error('Mais de 10.000 contas. Restrinja os filtros para selecionar o público completo.');
  const phones=new Set<string>();
  return rows.flatMap(row=>{const phone=campaignPhone(row.phone);if(!phone||phones.has(phone))return [];phones.add(phone);return [{...row,phone}];});
}

export async function saveCampaignAudience(id:string, input:unknown, actor:string) {
  const filters=audienceFiltersSchema.parse(input);
  const rows=await pg`update whatsapp_campaigns set audience_filters=${JSON.stringify(filters)}::jsonb,updated_at=now(),updated_by=${actor} where id=${id} and state='draft' returning id`;
  if(!rows.length)throw new Error('Somente rascunhos podem mudar de público.');
  return getCampaign(id);
}

export async function campaignMetrics(id:string, days=7) {
  if(![7,14,30].includes(days))throw new Error('Janela de relatório inválida.');
  const [row]=await pg<{total:number;sent:number;delivered:number;read:number;failed:number;tracked_clicks:number;trials:number;paying:number}[]>`select count(r.id)::int as total,
    count(*) filter(where r.state='sent' or d.accepted_at is not null)::int as sent,
    count(*) filter(where d.delivered_at is not null or d.read_at is not null)::int as delivered,
    count(*) filter(where d.read_at is not null)::int as read,
    count(*) filter(where r.state='failed' or d.failed_at is not null)::int as failed,
    count(*) filter(where d.clicked_at is not null)::int as tracked_clicks,
    count(*) filter(where coalesce(d.delivered_at,d.read_at) is not null and exists(select 1 from credit_transactions t
      where t.user_id=r.user_id and t.type='trial_grant' and t.created_at>=coalesce(d.delivered_at,d.read_at)
      and t.created_at<coalesce(d.delivered_at,d.read_at)+make_interval(days=>${days})))::int as trials,
    count(*) filter(where coalesce(d.delivered_at,d.read_at) is not null and exists(select 1 from payments p
      where p.user_id=r.user_id and p.status='succeeded' and p.amount>0 and (p.purpose is null or p.purpose in ('subscription','legacy_renewal'))
      and p.paid_at>=coalesce(d.delivered_at,d.read_at) and p.paid_at<coalesce(d.delivered_at,d.read_at)+make_interval(days=>${days})))::int as paying
    from whatsapp_campaign_recipients r left join whatsapp_template_deliveries d on d.id=r.delivery_id where r.campaign_id=${id}`;
  return {...row,windowDays:days};
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
  const audience = (await campaignAudience(undefined,campaign.audience_filters)).filter(u => userIds.includes(u.id));
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
