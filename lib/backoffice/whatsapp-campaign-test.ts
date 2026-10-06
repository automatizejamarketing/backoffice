import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, postgresClient as pg } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getCampaign } from "./whatsapp-campaigns";
import { campaignPhone, firstName } from "./whatsapp-campaign-core";
import { findCampaignTemplate, sendCampaignTemplate, whatsappMetaConfigured, WhatsappMetaError } from "./whatsapp-meta";
import { reconcileWhatsappTemplateDelivery } from "@/lib/meta-business/whatsapp/delivery-status-repository";

export async function campaignTestContacts() {
  const ids = (process.env.WHATSAPP_CAMPAIGN_TEST_USER_IDS ?? '').split(',').map(id => id.trim()).filter(id => z.string().uuid().safeParse(id).success);
  if (!ids.length) return [];
  const users = await pg<{id:string;name:string|null;phone:string}[]>`select id,name,phone from users where id=any(${ids}::uuid[]) order by name,id`;
  return users.flatMap(user => {
    const phone = campaignPhone(user.phone);
    return phone ? [{ ...user, phone }] : [];
  });
}

export async function sendCampaignTest(campaignId: string, input: unknown, actor: string) {
  const { userId, requestId } = z.object({userId:z.string().uuid(),requestId:z.string().uuid()}).parse(input);
  if (process.env.WHATSAPP_CAMPAIGNS_ENABLED !== 'true' || !whatsappMetaConfigured()) throw new Error('O envio de WhatsApp não está habilitado neste ambiente.');
  const contact = (await campaignTestContacts()).find(user => user.id === userId);
  if (!contact) throw new Error('Escolha um número habilitado para testes.');
  const campaign = await getCampaign(campaignId);
  const template = await findCampaignTemplate(campaign.template_name);
  if (template?.status !== 'APPROVED' || template.components.find(c => c.type === 'BODY')?.text !== campaign.body) throw new Error('Salve o texto idêntico ao template aprovado pela Meta antes de testar.');
  // Reusing the same request never sends twice, including when the HTTP response is lost.
  const key = `${campaignId}:${createHash('sha256').update(actor).digest('hex').slice(0,16)}:${requestId}`;
  const [delivery] = await pg<{id:string}[]>`insert into whatsapp_template_deliveries (user_id,source,source_delivery_id,template_name,language_code)
    values (${contact.id},'backoffice_campaign_test',${key},${campaign.template_name},'pt_BR')
    on conflict (source,source_delivery_id) do nothing returning id`;
  if (!delivery) {
    const [existing] = await pg`select provider_message_id,current_status from whatsapp_template_deliveries where source='backoffice_campaign_test' and source_delivery_id=${key}`;
    return { status: existing?.provider_message_id ? 'accepted' : existing?.current_status === 'failed' ? 'failed' : 'unknown' };
  }
  let providerId: string | null = null;
  try {
    providerId = await sendCampaignTemplate(contact.phone,campaign.template_name,campaign.body,firstName(contact.name));
    await db.transaction(async tx => {
      await tx.execute(sql`update whatsapp_template_deliveries set provider_message_id=${providerId},current_status='sent',accepted_at=now(),updated_at=now() where id=${delivery.id}`);
      await reconcileWhatsappTemplateDelivery(tx,providerId!);
    });
    return {status:'accepted'};
  } catch (error) {
    if (providerId) {
      await pg`update whatsapp_template_deliveries set provider_message_id=${providerId},accepted_at=coalesce(accepted_at,now()),updated_at=now() where id=${delivery.id}`;
      return {status:'accepted'};
    }
    const definitive = error instanceof WhatsappMetaError && error.definitive;
    await pg`update whatsapp_template_deliveries set current_status=${definitive?'failed':'queued'},failure_detail=${definitive?'Teste recusado pela Meta.':'Teste sem confirmação. Conferir o telefone antes de repetir.'},updated_at=now() where id=${delivery.id}`;
    return {status:definitive?'failed':'unknown'};
  }
}
