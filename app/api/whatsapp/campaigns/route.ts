import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { campaignAudience, campaignRecipients, excludeCampaignRecipient, getCampaign, listCampaigns, saveCampaign, scheduleCampaign, setCampaignPaused } from "@/lib/backoffice/whatsapp-campaigns";
import { findCampaignTemplate, submitCampaignTemplate, whatsappMetaConfigured } from "@/lib/backoffice/whatsapp-meta";

export const maxDuration = 60;
const uuid = z.string().uuid();
function failure(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  if (error && typeof error === 'object' && 'code' in error) return NextResponse.json({ error: "Não foi possível acessar as campanhas. Confira a configuração e as migrations deste ambiente." }, { status: 503 });
  return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível concluir a operação." }, { status: 400 });
}
export async function GET(request: Request) {
  const auth = await requireBackofficePermissionResponse("whatsapp:campaigns");
  if (!auth.ok) return auth.response;
  try {
    const params = new URL(request.url).searchParams;
    if (params.has('id')) {
      const id = uuid.parse(params.get('id'));
      const campaign = await getCampaign(id);
      const [recipients, template] = await Promise.all([campaignRecipients(id), whatsappMetaConfigured() ? findCampaignTemplate(campaign.template_name) : Promise.resolve(null)]);
      return NextResponse.json({ campaign, recipients, template });
    }
    const [campaigns, audience] = await Promise.all([listCampaigns(), campaignAudience()]);
    return NextResponse.json({ campaigns, audience, configured: whatsappMetaConfigured(), enabled: process.env.WHATSAPP_CAMPAIGNS_ENABLED === 'true' });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const auth = await requireBackofficePermissionResponse("whatsapp:campaigns");
  if (!auth.ok) return auth.response;
  try {
    const input = z.object({action:z.enum(['save','submit','schedule','sendNow','pause','resume','exclude']),id:uuid,data:z.unknown().optional()}).parse(await request.json());
    const actor = auth.actor.email;
    switch (input.action) {
      case 'save': return NextResponse.json({campaign:await saveCampaign(input.id,input.data,actor)});
      case 'submit': {
        const campaign=await getCampaign(input.id);
        if(campaign.state!=='draft')throw new Error('Somente rascunhos podem ser enviados para aprovação.');
        return NextResponse.json(await submitCampaignTemplate(campaign.template_name,campaign.body));
      }
      case 'schedule': {
        if (process.env.WHATSAPP_CAMPAIGNS_ENABLED !== 'true') throw new Error('O processamento de campanhas ainda não está habilitado.');
        const data=z.object({scheduledAt:z.string().datetime({offset:true}),userIds:z.array(uuid).min(1).max(10000)}).parse(input.data);
        await scheduleCampaign(input.id,new Date(data.scheduledAt),data.userIds,actor); break;
      }
      case 'sendNow': {
        if (process.env.WHATSAPP_CAMPAIGNS_ENABLED !== 'true') throw new Error('O processamento de campanhas ainda não está habilitado.');
        const data=z.object({userIds:z.array(uuid).min(1).max(10000)}).parse(input.data);
        await scheduleCampaign(input.id,null,data.userIds,actor); break;
      }
      case 'pause': await setCampaignPaused(input.id,true,actor); break;
      case 'resume':
        if (process.env.WHATSAPP_CAMPAIGNS_ENABLED !== 'true') throw new Error('O processamento de campanhas ainda não está habilitado.');
        await setCampaignPaused(input.id,false,actor); break;
      case 'exclude': await excludeCampaignRecipient(input.id,uuid.parse(input.data),actor); break;
    }
    return NextResponse.json({ok:true});
  } catch(error) { return failure(error); }
}
