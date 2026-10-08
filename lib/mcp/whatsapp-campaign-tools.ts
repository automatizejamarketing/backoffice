import "server-only";

import { randomUUID } from "node:crypto";
import * as z from "zod/v4";
import { AUDIENCE_STATUSES, audienceFiltersSchema, templateRejectionReason, type AudienceStatus } from "@/lib/backoffice/whatsapp-campaign-audience";
import { CAMPAIGN_CONTACT_BUTTON, CAMPAIGN_MEDIA_RULES, campaignSpec, trackedLinkButton, type CampaignButton, type CampaignHeaderMedia } from "@/lib/backoffice/whatsapp-campaign-core";
import { importCampaignMedia } from "@/lib/backoffice/whatsapp-campaign-media";
import { getCampaignPricing } from "@/lib/backoffice/whatsapp-campaign-pricing";
import { campaignTestContacts, sendCampaignTest } from "@/lib/backoffice/whatsapp-campaign-test";
import {
  campaignAudience, campaignMetrics, deleteCampaign, getCampaign, listCampaigns,
  saveCampaign, saveCampaignAudience, scheduleCampaign, setCampaignPaused, type CampaignRow,
} from "@/lib/backoffice/whatsapp-campaigns";
import { findCampaignTemplate, submitCampaignTemplate } from "@/lib/backoffice/whatsapp-meta";
import { putMediaObject } from "@/lib/storage/media-r2";
import { sendConfirmationCode, verifySendConfirmation } from "./send-confirmation";
import { defineTool, type McpTool } from "./tool";

const campaignId = z.string().uuid().describe("ID da campanha (list_whatsapp_campaigns).");
const reais = (micros: number | string) => Number(micros) / 1_000_000;
const dispatchEnabled = () => process.env.WHATSAPP_CAMPAIGNS_ENABLED === "true";

function summary(c: CampaignRow) {
  return {
    id: c.id, title: c.title, templateName: c.template_name, state: c.state,
    dispatchMode: c.dispatch_mode, scheduledAt: c.scheduled_at,
    budgetReais: reais(c.budget_micros), unitCostReais: reais(c.unit_cost_micros),
    ...(c.total !== undefined ? { recipients: c.total, sent: c.sent, delivered: c.delivered, read: c.read, failed: c.failed, pending: c.pending } : {}),
  };
}

function detail(c: CampaignRow) {
  return { ...summary(c), body: c.body, button: c.button, headerMedia: c.header_media, audienceFilters: c.audience_filters };
}

function confirmationSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET não configurado.");
  return secret;
}

async function sendPreview(id: string, scheduledAt: string | null) {
  const campaign = await getCampaign(id);
  const [audience, template, pricing] = await Promise.all([
    campaignAudience(undefined, campaign.audience_filters),
    findCampaignTemplate(campaign.template_name).catch(() => null),
    getCampaignPricing().catch(() => null),
  ]);
  const byStatus = Object.fromEntries(Object.keys(AUDIENCE_STATUSES).map(s => [s, audience.filter(u => u.account_status === s).length]).filter(([, n]) => n));
  const estimatedCostReais = reais(audience.length * campaign.unit_cost_micros);
  const issues = [
    !dispatchEnabled() && "Os disparos não estão habilitados neste ambiente.",
    campaign.state !== "draft" && "A campanha já foi agendada ou enviada.",
    template?.status !== "APPROVED" && `Template ainda não aprovado pela Meta (${template?.status ?? "não encontrado"}).`,
    !audience.length && "Nenhum destinatário elegível com os filtros salvos.",
    audience.length * campaign.unit_cost_micros > Number(campaign.budget_micros) && "A estimativa passa do orçamento. Aumente o orçamento ou restrinja o público.",
    campaign.unit_cost_micros <= 0 && "Tarifa da Meta indisponível no rascunho: salve o rascunho de novo.",
    pricing && campaign.unit_cost_micros > 0 && pricing.unitCostMicros !== campaign.unit_cost_micros && "A tarifa da Meta mudou: salve o rascunho de novo antes de confirmar.",
    scheduledAt && new Date(scheduledAt) <= new Date() && "O horário escolhido já passou.",
  ].filter((issue): issue is string => Boolean(issue));
  return {
    campaign, audience, issues,
    preview: {
      campaign: summary(campaign), body: campaign.body, button: campaign.button, headerMedia: campaign.header_media,
      when: scheduledAt ?? "agora (envio manual)", recipients: audience.length,
      recipientsByStatus: Object.fromEntries(Object.entries(byStatus).map(([s, n]) => [AUDIENCE_STATUSES[s as AudienceStatus], n])),
      estimatedCostReais, budgetReais: reais(campaign.budget_micros), metaTemplateStatus: template?.status ?? "MISSING",
    },
  };
}

const buttonInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("contact").describe(`Botão "${CAMPAIGN_CONTACT_BUTTON.text}" para o WhatsApp da equipe, com clique rastreado.`) }),
  z.object({ type: z.literal("link"), text: z.string().max(25), url: z.string().describe("Destino https (ex.: grupo do WhatsApp). O botão passa pelo nosso link rastreado e registra quem clicou.") }),
]);

function toButton(input: z.infer<typeof buttonInput>): CampaignButton | null {
  if (input.type === "none") return null;
  if (input.type === "contact") return CAMPAIGN_CONTACT_BUTTON;
  return trackedLinkButton(input.text, input.url);
}

async function resolveMedia(id: string, mediaUrl: string | null | undefined, current: CampaignHeaderMedia | null): Promise<CampaignHeaderMedia | null> {
  if (mediaUrl === undefined) return current;
  if (mediaUrl === null) return null;
  if (current?.url === mediaUrl) return current;
  return importCampaignMedia(id, mediaUrl, async (pathname, body, contentType) =>
    (await putMediaObject(pathname, body, { contentType, addRandomSuffix: true })).url);
}

export const WHATSAPP_CAMPAIGN_TOOLS: McpTool[] = [
  defineTool({
    name: "list_whatsapp_campaigns", title: "Listar campanhas de WhatsApp", permission: "whatsapp:campaigns", write: false,
    description: "Lista as 100 campanhas mais recentes com status, agendamento, orçamento e contagem de envios. Também informa a tarifa atual da Meta por mensagem e se os disparos estão habilitados.",
    input: z.object({}),
    async run() {
      const [campaigns, pricing] = await Promise.all([listCampaigns(), getCampaignPricing().catch(() => null)]);
      return { campaigns: campaigns.map(summary), unitCostReais: pricing ? reais(pricing.unitCostMicros) : null, dispatchEnabled: dispatchEnabled() };
    },
  }),
  defineTool({
    name: "get_whatsapp_campaign", title: "Ver campanha de WhatsApp", permission: "whatsapp:campaigns", write: false,
    description: "Mostra uma campanha: texto, botão, mídia, filtros de público, status do template na Meta (com motivo de rejeição) e resultados (entregas, leituras, cliques, trials e pagamentos na janela).",
    input: z.object({ campaignId, days: z.union([z.literal(7), z.literal(14), z.literal(30)]).default(7).describe("Janela de conversão em dias.") }),
    async run(_actor, { campaignId: id, days }) {
      const campaign = await getCampaign(id);
      const [template, metrics] = await Promise.all([findCampaignTemplate(campaign.template_name).catch(() => null), campaignMetrics(id, days)]);
      return {
        campaign: detail(campaign), metrics,
        metaTemplate: template ? { status: template.status, category: template.category, rejectedReason: templateRejectionReason(template.status, template.rejected_reason) } : null,
      };
    },
  }),
  defineTool({
    name: "save_whatsapp_campaign_draft", title: "Salvar rascunho de campanha", permission: "whatsapp:campaigns", write: true,
    description:
      "Cria (sem campaignId) ou edita (com campaignId) um rascunho. Texto até 1024 caracteres, sem links (links vão no botão, sempre rastreado); use {{1}} para o primeiro nome. " +
      `Mídia opcional por link público https (Google Drive aceito): ${CAMPAIGN_MEDIA_RULES.image.label} ou ${CAMPAIGN_MEDIA_RULES.video.label}. ` +
      "Texto, mídia e botão vão juntos para aprovação: depois de aprovado, qualquer mudança exige um novo templateName (ex.: _v2). Não envia nada.",
    input: z.object({
      campaignId: campaignId.optional().describe("Omita para criar uma campanha nova."),
      title: z.string().min(1).max(160).describe("Nome interno da campanha."),
      templateName: z.string().regex(/^[a-z0-9_]{1,255}$/).describe("Nome do template na Meta: minúsculas, números e _. Ex.: outubro_2026_0910_assinatura_v3."),
      body: z.string().min(1).max(1024),
      budgetReais: z.number().min(0).max(100_000).describe("Orçamento máximo estimado em reais."),
      button: buttonInput,
      mediaUrl: z.string().nullable().optional().describe("Link público da imagem/vídeo. Omita para manter a atual; null remove."),
    }),
    async run(actor, input) {
      const id = input.campaignId ?? randomUUID();
      const current = input.campaignId ? await getCampaign(id) : null;
      const [headerMedia, pricing] = await Promise.all([
        resolveMedia(id, input.mediaUrl, current?.header_media ?? null),
        getCampaignPricing().catch(() => null),
      ]);
      const campaign = await saveCampaign(id, {
        title: input.title, templateName: input.templateName, body: input.body,
        unitCostMicros: pricing?.unitCostMicros ?? 0, budgetMicros: Math.round(input.budgetReais * 1_000_000),
        button: toButton(input.button), headerMedia,
      }, actor.email);
      return { campaign: detail(campaign), next: "Use submit_whatsapp_template para mandar o template à Meta (se ainda não existir aprovado com este nome)." };
    },
  }),
  defineTool({
    name: "delete_whatsapp_campaign_draft", title: "Excluir rascunho", permission: "whatsapp:campaigns", write: true, destructive: true,
    description: "Exclui um rascunho que ainda não teve envios. O template continua cadastrado na Meta.",
    input: z.object({ campaignId }),
    async run(_actor, { campaignId: id }) { await deleteCampaign(id); return { deleted: id }; },
  }),
  defineTool({
    name: "submit_whatsapp_template", title: "Enviar template à Meta", permission: "whatsapp:campaigns", write: true,
    description: "Envia texto, mídia e botão do rascunho para aprovação da Meta. Se o nome já existir com o mesmo conteúdo, só confirma o status. A aprovação costuma levar de minutos a algumas horas; consulte com get_whatsapp_campaign.",
    input: z.object({ campaignId }),
    async run(_actor, { campaignId: id }) {
      const campaign = await getCampaign(id);
      if (campaign.state !== "draft") throw new Error("Somente rascunhos podem ser enviados para aprovação.");
      return submitCampaignTemplate(campaignSpec(campaign));
    },
  }),
  defineTool({
    name: "set_whatsapp_campaign_audience", title: "Definir público", permission: "whatsapp:campaigns", write: true,
    description:
      "Salva os filtros de público do rascunho e devolve quantos contatos elegíveis existem. Situações: " +
      Object.entries(AUDIENCE_STATUSES).map(([k, v]) => `${k} (${v})`).join(", ") +
      ". Datas no formato AAAA-MM-DD, horário de Brasília. Contas internas e telefones duplicados ficam de fora.",
    input: z.object({
      campaignId,
      statuses: z.array(z.enum(Object.keys(AUDIENCE_STATUSES) as [AudienceStatus, ...AudienceStatus[]])).min(1),
      createdFrom: z.string().optional(), createdTo: z.string().optional(),
      expiresFrom: z.string().optional(), expiresTo: z.string().optional(),
      excludeContacted: z.boolean().default(true).describe("Exclui quem já foi atendido no CRM ou no WhatsApp integrado."),
    }),
    async run(actor, { campaignId: id, ...filters }) {
      const campaign = await saveCampaignAudience(id, audienceFiltersSchema.parse(filters), actor.email);
      const audience = await campaignAudience(undefined, campaign.audience_filters);
      return { eligibleContacts: audience.length, estimatedCostReais: reais(audience.length * campaign.unit_cost_micros), budgetReais: reais(campaign.budget_micros) };
    },
  }),
  defineTool({
    name: "list_whatsapp_test_contacts", title: "Números de teste", permission: "whatsapp:campaigns", write: false,
    description: "Lista os contatos habilitados para receber testes de campanha.",
    input: z.object({}),
    async run() { return { contacts: (await campaignTestContacts()).map(c => ({ userId: c.id, name: c.name })) }; },
  }),
  defineTool({
    name: "send_whatsapp_campaign_test", title: "Enviar teste", permission: "whatsapp:campaigns", write: true,
    description: "Envia a mensagem aprovada para um número de teste (list_whatsapp_test_contacts). Não consome o público nem a campanha.",
    input: z.object({ campaignId, testUserId: z.string().uuid() }),
    async run(actor, { campaignId: id, testUserId }) { return sendCampaignTest(id, { userId: testUserId, requestId: randomUUID() }, actor.email); },
  }),
  defineTool({
    name: "preview_whatsapp_campaign_send", title: "Prévia do envio", permission: "whatsapp:campaigns", write: false,
    description:
      "Mostra o que será enviado (mensagem, quantidade de destinatários, custo estimado, orçamento, horário) e os impedimentos. " +
      "Devolve um confirmationCode (vale 15 minutos) quando não há impedimentos. Mostre a prévia ao usuário e só chame confirm_whatsapp_campaign_send depois que ele aprovar explicitamente.",
    input: z.object({ campaignId, scheduledAt: z.string().datetime({ offset: true }).optional().describe("Data e hora com fuso, ex.: 2026-10-09T15:00:00-03:00. Omita para enviar agora.") }),
    async run(_actor, { campaignId: id, scheduledAt }) {
      const { campaign, audience, issues, preview } = await sendPreview(id, scheduledAt ?? null);
      return {
        ...preview, issues,
        ...(issues.length ? {} : { confirmationCode: sendConfirmationCode({ campaignId: id, revision: campaign.revision, scheduledAt: scheduledAt ?? null, userIds: audience.map(u => u.id) }, confirmationSecret()) }),
      };
    },
  }),
  defineTool({
    name: "confirm_whatsapp_campaign_send", title: "Confirmar envio", permission: "whatsapp:campaigns", write: true, destructive: true,
    description:
      "Agenda ou inicia o envio real da campanha (gasta dinheiro na Meta). Exige o confirmationCode da prévia e falha se campanha, público ou horário mudaram. " +
      "Nunca chame sem a aprovação explícita do usuário para a prévia mostrada.",
    input: z.object({ campaignId, scheduledAt: z.string().datetime({ offset: true }).optional(), confirmationCode: z.string().min(8).describe("Código devolvido pela prévia; vale 15 minutos.") }),
    async run(actor, { campaignId: id, scheduledAt, confirmationCode }) {
      if (!dispatchEnabled()) throw new Error("Os disparos não estão habilitados neste ambiente.");
      const { campaign, audience, issues } = await sendPreview(id, scheduledAt ?? null);
      if (issues.length) throw new Error(issues.join(" "));
      const userIds = audience.map(u => u.id);
      const check = verifySendConfirmation(confirmationCode, { campaignId: id, revision: campaign.revision, scheduledAt: scheduledAt ?? null, userIds }, confirmationSecret());
      if (check === "expired") throw new Error("A prévia expirou. Gere uma nova prévia e confirme com o usuário.");
      if (check !== "ok") throw new Error("A campanha, o público ou o horário mudaram desde a prévia. Gere uma nova prévia e confirme com o usuário.");
      // The confirmed revision travels to the claim: an edit after this check makes scheduling fail.
      await scheduleCampaign(id, scheduledAt ? new Date(scheduledAt) : null, userIds, actor.email, campaign.revision);
      return { campaign: summary(await getCampaign(id)), recipients: userIds.length };
    },
  }),
  defineTool({
    name: "set_whatsapp_campaign_paused", title: "Pausar ou retomar", permission: "whatsapp:campaigns", write: true,
    description: "Pausa (paused=true) ou retoma (paused=false) uma campanha agendada.",
    input: z.object({ campaignId, paused: z.boolean() }),
    async run(actor, { campaignId: id, paused }) {
      if (!paused && !dispatchEnabled()) throw new Error("Os disparos não estão habilitados neste ambiente.");
      await setCampaignPaused(id, paused, actor.email);
      return { campaign: summary(await getCampaign(id)) };
    },
  }),
];
