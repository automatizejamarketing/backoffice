import { z } from "zod";
import { normalizeBrazilianPhone } from "@/lib/phone";

/** Tracked contact button: each delivery ID becomes the {{1}} of the URL. */
export const CAMPAIGN_CONTACT_BUTTON = { text: "Falar com a equipe", url: "https://www.automatizemarketing.com/contato-direto/{{1}}" } as const;
export const CAMPAIGN_MEDIA_RULES = {
  image: { types: ["image/jpeg", "image/png"], maxBytes: 5 * 1024 * 1024, label: "JPG ou PNG, até 5 MB" },
  video: { types: ["video/mp4"], maxBytes: 16 * 1024 * 1024, label: "MP4 (H.264), até 16 MB" },
} as const;

const buttonSchema = z.object({
  text: z.string().trim().min(1, "Informe o texto do botão.").max(25, "O texto do botão tem no máximo 25 caracteres."),
  url: z.string().trim().url("Informe um link válido.").max(2000).refine(url => url.startsWith("https://"), "Use um link https."),
}).refine(button => !button.url.includes("{{") || button.url === CAMPAIGN_CONTACT_BUTTON.url, { message: "O link do botão não pode ter variáveis.", path: ["url"] });
const headerMediaSchema = z.object({ type: z.enum(["image", "video"]), url: z.string().url().refine(url => url.startsWith("https://")) });
export type CampaignButton = z.infer<typeof buttonSchema>;
export type CampaignHeaderMedia = z.infer<typeof headerMediaSchema>;
/** What Meta approves and what each send must repeat: header, body and button. */
export type CampaignTemplateSpec = { name: string; body: string; button: CampaignButton | null; headerMedia: CampaignHeaderMedia | null };

export function campaignSpec(campaign: { template_name: string; body: string; button: CampaignButton | null; header_media: CampaignHeaderMedia | null }): CampaignTemplateSpec {
  return { name: campaign.template_name, body: campaign.body, button: campaign.button, headerMedia: campaign.header_media };
}

export function campaignTracksClicks(button: CampaignButton | null | undefined): boolean {
  return button?.url === CAMPAIGN_CONTACT_BUTTON.url;
}

export const campaignInput = z.object({
  title: z.string().trim().min(1).max(160),
  templateName: z.string().regex(/^[a-z0-9_]{1,255}$/),
  body: z.string().trim().min(1).max(1024),
  unitCostMicros: z.number().int().min(0).max(100_000_000),
  budgetMicros: z.number().int().min(0).max(100_000_000_000),
  button: buttonSchema.nullable().default(null),
  headerMedia: headerMediaSchema.nullable().default(null),
}).superRefine((value, ctx) => {
  if (value.body.replaceAll("{{1}}", "").match(/{{|}}|\[(?:LINK|NOME|PERÍODO|RESULTADO)/)) {
    ctx.addIssue({ code: "custom", path: ["body"], message: "Use apenas {{1}} para o primeiro nome e substitua todos os links pendentes." });
  }
});

export function campaignPhone(value: string | null): string | null {
  const digits = normalizeBrazilianPhone(value);
  return digits && /^[1-9]{2}(?:9\d{8}|[2-5]\d{7})$/.test(digits) ? `55${digits}` : null;
}

export function firstName(name: string | null): string {
  return name?.trim().split(/\s+/)[0]?.slice(0, 60) || "tudo bem";
}

/** Meta only approves media headers with an example uploaded beforehand (`headerHandle`). */
export function campaignTemplateDefinition(spec: CampaignTemplateSpec, headerHandle?: string) {
  const { name, body, button, headerMedia } = spec;
  if (headerMedia && !headerHandle) throw new Error("Envie a mídia de exemplo antes de cadastrar o template.");
  return {
    name, language: "pt_BR", category: "MARKETING",
    components: [
      ...(headerMedia ? [{ type: "HEADER", format: headerMedia.type.toUpperCase(), example: { header_handle: [headerHandle!] } }] : []),
      { type: "BODY", text: body, ...(body.includes("{{1}}") ? { example: { body_text: [["João"]] } } : {}) },
      ...(button ? [{ type: "BUTTONS", buttons: [{ type: "URL", text: button.text, url: button.url, ...(campaignTracksClicks(button) ? {example: [button.url.replace("{{1}}", "00000000-0000-4000-8000-000000000001")]} : {}) }] }] : []),
    ],
  };
}

export function campaignTemplateMatches(template: {components: Array<{type:string;text?:string;format?:unknown;buttons?:unknown}>}|null, spec: CampaignTemplateSpec): boolean {
  if (template?.components.find(c=>c.type==='BODY')?.text !== spec.body) return false;
  if (template.components.find(c=>c.type==='HEADER')?.format !== spec.headerMedia?.type.toUpperCase()) return false;
  const expected = spec.button;
  const buttons = template.components.find(c=>c.type==='BUTTONS')?.buttons;
  if (!expected) return !buttons || (Array.isArray(buttons) && buttons.length===0);
  return Array.isArray(buttons) && buttons.length===1 && buttons[0]?.type==='URL' && buttons[0]?.text===expected.text && buttons[0]?.url===expected.url;
}

export function assertSchedule(input: {
  scheduledAt: Date; now: Date; count: number; unitCostMicros: number;
  budgetMicros: number; templateStatus: string; templateBody: string; body: string;
  dispatchMode?: "manual" | "scheduled";
}) {
  if (!Number.isFinite(input.scheduledAt.getTime()) || (input.dispatchMode !== "manual" && input.scheduledAt <= input.now))
    throw new Error("Escolha uma data e hora futuras (horário de Brasília).");
  if (!input.count) throw new Error("Nenhum destinatário elegível selecionado.");
  if (input.templateStatus !== "APPROVED" || input.templateBody !== input.body)
    throw new Error("O texto precisa corresponder ao template aprovado pela Meta.");
  if (input.unitCostMicros <= 0 || input.count * input.unitCostMicros > input.budgetMicros)
    throw new Error("A estimativa excede o orçamento. Ajuste o público ou o orçamento.");
}

export const CAMPAIGN_STATE_LABELS: Record<string, string> = {
  draft: "Rascunho salvo", scheduled: "Agendada", paused: "Pausada", completed: "Concluída",
};
export const RECIPIENT_STATE_LABELS: Record<string, string> = {
  pending: "Na fila", sending: "Em envio", sent: "Enviado", failed: "Falhou",
  skipped: "Não elegível", unknown: "Verificar envio", excluded: "Excluído",
};


export type CampaignMetaLookup = "found" | "missing" | "unavailable" | "disconnected";
export function campaignMetaLookupLabel(lookup: CampaignMetaLookup): string {
  return { found: "Consultado", missing: "Template não encontrado", unavailable: "Consulta indisponível", disconnected: "Conexão pendente" }[lookup];
}
export function canConfirmCampaignSend(enabled: boolean, status?: string): boolean {
  return enabled && status === "APPROVED";
}

export function campaignSendComponents(spec: CampaignTemplateSpec, firstName: string, deliveryId?: string) {
  const tracked = campaignTracksClicks(spec.button);
  if (tracked && !z.string().uuid().safeParse(deliveryId).success)
    throw new Error("O envio rastreável precisa de um identificador de entrega válido.");
  const media = spec.headerMedia;
  return [
    ...(media ? [{ type: "header", parameters: [{ type: media.type, [media.type]: { link: media.url } }] }] : []),
    ...(spec.body.includes("{{1}}") ? [{ type: "body", parameters: [{ type: "text", text: firstName }] }] : []),
    ...(tracked ? [{type: "button", sub_type: "url", index: "0", parameters: [{type: "text", text: deliveryId!}]}] : []),
  ];
}
