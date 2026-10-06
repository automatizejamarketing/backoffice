import "server-only";
import { db, postgresClient as pg } from "@/lib/db";
import { sql } from "drizzle-orm";
import { campaignAudience, type CampaignRow } from "./whatsapp-campaigns";
import { firstName } from "./whatsapp-campaign-core";
import { findCampaignTemplate, sendCampaignTemplate, WhatsappMetaError } from "./whatsapp-meta";
import { reconcileWhatsappTemplateDelivery } from "@/lib/meta-business/whatsapp/delivery-status-repository";

/** A sending claim is never retried automatically: Meta has no send idempotency key. */
export async function dispatchWhatsappCampaigns() {
  if (process.env.WHATSAPP_CAMPAIGNS_ENABLED !== "true") return { enabled: false, processed: 0 };
  await pg`update whatsapp_campaign_recipients set state='unknown',reason='Envio interrompido. Verifique na Meta antes de tentar novamente.',updated_at=now()
    where state='sending' and updated_at < now() - interval '10 minutes'`;
  // Empty or uncertain campaigns must not occupy all five executable slots.
  await pg`update whatsapp_campaigns c set
    state=case when exists (select 1 from whatsapp_campaign_recipients r where r.campaign_id=c.id and r.state='unknown') then 'paused' else 'completed' end,
    updated_at=now(),updated_by='system:reconcile'
    where c.state='scheduled' and c.scheduled_at <= now() and not exists (
      select 1 from whatsapp_campaign_recipients r where r.campaign_id=c.id and r.state in ('pending','sending'))`;
  const campaigns = await pg<CampaignRow[]>`select c.* from whatsapp_campaigns c
    where c.state='scheduled' and c.scheduled_at <= now() and exists (
      select 1 from whatsapp_campaign_recipients r where r.campaign_id=c.id and r.state='pending')
    order by c.scheduled_at limit 5`;
  let processed = 0;
  for (const campaign of campaigns) {
    const template = await findCampaignTemplate(campaign.template_name);
    if (template?.status !== 'APPROVED' || template.components.find(c => c.type === 'BODY')?.text !== campaign.body) {
      await pg`update whatsapp_campaigns set state='paused',updated_at=now(),updated_by='system:template' where id=${campaign.id} and state='scheduled'`;
      continue;
    }
    // Serial processing bounds provider traffic. Each DB claim also supports overlapping cron runs.
    while (processed < 20) {
      const [recipient] = await pg<{id: string;user_id: string;phone: string}[]>`
        with next as (
          select r.id from whatsapp_campaign_recipients r join whatsapp_campaigns c on c.id=r.campaign_id
          where r.campaign_id=${campaign.id} and r.state='pending' and c.state='scheduled'
          order by r.id for update of r skip locked limit 1
        ) update whatsapp_campaign_recipients r set state='sending',updated_at=now()
          from next where r.id=next.id returning r.id,r.user_id,r.phone`;
      if (!recipient) break;
      processed++;
      let providerId: string | null = null;
      let deliveryId: string | null = null;
      let attempted = false;
      try {
        const contact = (await campaignAudience(recipient.user_id))[0];
        if (!contact || contact.phone !== recipient.phone) {
          await pg`update whatsapp_campaign_recipients set state='skipped',reason='Trial, assinatura, contato comercial ou telefone alterado.',updated_at=now() where id=${recipient.id}`;
          continue;
        }
        const [active] = await pg`select id from whatsapp_campaigns where id=${campaign.id} and state='scheduled'`;
        if (!active) {
          await pg`update whatsapp_campaign_recipients set state='pending',updated_at=now() where id=${recipient.id}`;
          break;
        }
        const [delivery] = await pg<{id:string}[]>`insert into whatsapp_template_deliveries (user_id,source,source_delivery_id,template_name,language_code)
          values (${recipient.user_id},'backoffice_campaign',${recipient.id},${campaign.template_name},'pt_BR') returning id`;
        deliveryId = delivery.id;
        await pg`update whatsapp_campaign_recipients set delivery_id=${deliveryId} where id=${recipient.id}`;
        attempted = true;
        providerId = await sendCampaignTemplate(recipient.phone, campaign.template_name, campaign.body, firstName(contact.name));
        await db.transaction(async tx => {
          await tx.execute(sql`update whatsapp_template_deliveries set provider_message_id=${providerId},current_status='sent',accepted_at=now(),updated_at=now() where id=${deliveryId}`);
          await reconcileWhatsappTemplateDelivery(tx, providerId!);
          await tx.execute(sql`update whatsapp_campaign_recipients set state='sent',reason=null,updated_at=now() where id=${recipient.id}`);
        });
      } catch (error) {
        const definitive = !attempted || (error instanceof WhatsappMetaError && error.definitive);
        const reason = definitive ? 'Falha confirmada. Confira a configuração e o template.' : 'A Meta pode ter recebido a mensagem. Não reenviar sem conferir.';
        // Persist the provider ID even if the first transaction failed; a webhook can reconcile delivery.
        if (providerId && deliveryId) await pg`update whatsapp_template_deliveries set provider_message_id=${providerId},accepted_at=coalesce(accepted_at,now()),updated_at=now() where id=${deliveryId}`;
        await pg`update whatsapp_campaign_recipients set state=${definitive ? 'failed' : 'unknown'},reason=${reason},updated_at=now() where id=${recipient.id}`;
        if (definitive && deliveryId) await pg`update whatsapp_template_deliveries set current_status='failed',failed_at=now(),failure_detail=${reason},updated_at=now() where id=${deliveryId}`;
        // Stop the campaign on provider errors, avoiding a whole cohort failing at once.
        await pg`update whatsapp_campaigns set state='paused',updated_by='system:send_error',updated_at=now() where id=${campaign.id} and state='scheduled'`;
        break;
      }
    }
    await pg`update whatsapp_campaigns c set state='completed',updated_at=now(),updated_by='system:completed'
      where c.id=${campaign.id} and c.state='scheduled' and not exists (
        select 1 from whatsapp_campaign_recipients r where r.campaign_id=c.id and r.state in ('pending','sending','unknown'))`;
    if (processed >= 20) break;
  }
  return { enabled: true, processed };
}
