import { createHmac } from "node:crypto";
import { z } from "zod";
import { campaignTemplateDefinition } from "./whatsapp-campaign-core";

const templateSchema = z.object({
  id: z.string(), name: z.string(), language: z.string(), status: z.string(),
  category: z.string(), rejected_reason: z.string().optional(),
  components: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).default([]),
});
export type CampaignMetaTemplate = z.infer<typeof templateSchema>;

export function whatsappMetaConfigured() {
  return Boolean(process.env.META_WHATSAPP_ACCESS_TOKEN && process.env.META_WHATSAPP_WABA_ID && process.env.META_WHATSAPP_PHONE_NUMBER_ID);
}

/** An HTTP refusal is definitive; a timeout/network error may have accepted the message. */
export class WhatsappMetaError extends Error {
  constructor(message: string, readonly definitive = false) { super(message); }
}

export async function whatsappMetaRequest(path: string, init?: RequestInit): Promise<unknown> {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new WhatsappMetaError("Configure a conta WhatsApp no ambiente do backoffice.", true);
  const url = new URL(`https://graph.facebook.com/v22.0/${path}`);
  const secret = process.env.META_GENERAL_APP_SECRET;
  if (secret) url.searchParams.set("appsecret_proof", createHmac("sha256", secret).update(token).digest("hex"));
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000), headers: {
    Authorization: `Bearer ${token}`, "Content-Type": "application/json",
  } });
  const result = await response.json();
  if (!response.ok) {
    // Never surface raw Graph requests or tokens. Provider messages can echo input.
    const code = typeof result?.error?.code === "number" ? result.error.code : response.status;
    throw new WhatsappMetaError(`A Meta recusou a operação (código ${code}). Confira a conta e o template no WhatsApp Manager.`, response.status < 500);
  }
  return result;
}

function waba() {
  const id = process.env.META_WHATSAPP_WABA_ID;
  if (!id || !/^\d+$/.test(id)) throw new Error("Configure META_WHATSAPP_WABA_ID no backoffice.");
  return id;
}

export async function findCampaignTemplate(name: string): Promise<CampaignMetaTemplate | null> {
  const query = new URLSearchParams({ name, fields: "id,name,language,status,category,components,rejected_reason", limit: "100" });
  const payload = z.object({ data: z.array(templateSchema) }).parse(await whatsappMetaRequest(`${waba()}/message_templates?${query}`));
  return payload.data.find(t => t.name === name && t.language === "pt_BR") ?? null;
}

export async function submitCampaignTemplate(name: string, body: string) {
  const existing = await findCampaignTemplate(name);
  if (existing) {
    if (existing.components.find(c => c.type === "BODY")?.text !== body)
      throw new Error("Esse nome já existe com outro texto. Use um novo nome/versionamento para aprovação.");
    return { id: existing.id, status: existing.status, existing: true };
  }
  const result = z.object({ id: z.string(), status: z.string() }).parse(await whatsappMetaRequest(`${waba()}/message_templates`, {
    method: "POST", body: JSON.stringify(campaignTemplateDefinition(name, body)),
  }));
  return { ...result, existing: false };
}

export async function sendCampaignTemplate(phone: string, name: string, body: string, firstName: string) {
  const phoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneId || !/^\d+$/.test(phoneId)) throw new WhatsappMetaError("Número remetente não configurado.", true);
  const result = z.object({ messages: z.array(z.object({ id: z.string() })).min(1) }).parse(await whatsappMetaRequest(`${phoneId}/messages`, {
    method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "template", template: {
      name, language: { code: "pt_BR" },
      ...(body.includes("{{1}}") ? { components: [{ type: "body", parameters: [{ type: "text", text: firstName }] }] } : {}),
    } }),
  }));
  return result.messages[0].id;
}
