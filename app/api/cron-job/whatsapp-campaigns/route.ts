import { NextResponse } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { dispatchWhatsappCampaigns } from "@/lib/backoffice/whatsapp-campaign-dispatch";
export const maxDuration = 300;
export async function GET(request: Request) {
  const auth = assertCronAuthorized(request,"[whatsapp-campaigns]");
  if(!auth.ok)return auth.response;
  try { return NextResponse.json(await dispatchWhatsappCampaigns()); }
  catch { return NextResponse.json({error:"Falha ao processar campanhas. Os envios incertos não serão repetidos automaticamente."},{status:500}); }
}
