import "server-only";

import * as z from "zod/v4";
import { canAccessMarketingUser, type BackofficeActor } from "@/lib/auth/rbac-core";
import { suggestOffers } from "@/lib/consultant-workspace/offer-suggestion-data";
import { OutreachError, previewOutreach, sendOutreach } from "@/lib/consultant-workspace/outreach";
import {
  normalizeOutreachBatch,
  OUTREACH_KIND_LABEL,
  outreachInputSchema,
  RECIPIENT_SOURCE_LABEL,
  type OutreachInput,
} from "@/lib/consultant-workspace/outreach-core";
import { loadSuggestedActions, runLiveChecks } from "@/lib/consultant-workspace/playbook-actions-data";
import { SITUATION_LABEL, type SuggestedAction } from "@/lib/consultant-workspace/playbook-actions";
import { batchConfirmationCode, verifyBatchConfirmation } from "./batch-confirmation";
import { defineTool, type McpTool } from "./tool";

/**
 * Ações sugeridas e mensagens da Mat pelo MCP.
 *
 * - `list_suggested_actions`: as situações do playbook de UM cliente (escalar,
 *   criativo ruim; pixel e saldo ao vivo só quando pedido).
 * - `preview_mat_messages` → `send_mat_messages`: o mesmo desenho das mudanças
 *   na Meta — prévia de cada mensagem no app, código de confirmação amarrado ao
 *   lote exato, envio em sequência depois da aprovação explícita.
 * - `suggest_offer`: 3 ofertas/combos da IA para o criativo ruim.
 */

const MAX_MESSAGES = 20;

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET ausente");
  return value;
}

function assertClientAccess(actor: BackofficeActor, userId: string) {
  if (!canAccessMarketingUser(actor, userId)) throw new Error("Este cliente não está na sua carteira.");
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** O que o MCP devolve de cada sugestão: o porquê, as ações e o rascunho da Mat pronto para a prévia. */
function describeSuggestion(userId: string, suggestion: SuggestedAction) {
  return {
    id: suggestion.id,
    situation: SITUATION_LABEL[suggestion.situation],
    severity: suggestion.severity,
    title: suggestion.title,
    why: suggestion.why,
    entity: suggestion.entity ?? null,
    openInsightIds: suggestion.insightIds,
    actions: suggestion.actions.map((action) => {
      if (action.type === "meta_pause") {
        return { type: "pausar_na_meta", label: action.label, viaTool: "preview_meta_changes", change: { userId, entityId: action.entityId, action: "pause", note: action.note } };
      }
      if (action.type === "mat") {
        return { type: "mensagem_da_mat", label: action.label, viaTool: "preview_mat_messages", message: { userId, ...action.draft } };
      }
      if (action.type === "offer_ai") return { type: "sugerir_oferta", label: action.label, viaTool: "suggest_offer", adIds: action.adIds };
      return { type: "link", label: action.label, href: action.href };
    }),
  };
}

const messageSchema = outreachInputSchema;

export const CONSULTANT_OUTREACH_TOOLS: McpTool[] = [
  defineTool({
    name: "list_suggested_actions",
    title: "Ações sugeridas do cliente",
    permission: "marketing:read",
    write: false,
    description:
      "Situações do playbook de UM cliente, com o porquê em números e as ações de um clique: campanha validou (ROAS ≥ 5, pedir aprovação para escalar), " +
      "criativo ruim (pausar, pedir criativos novos, sugerir oferta), e — só com includeLiveChecks — pixel e saldo/pagamento lidos AO VIVO na Meta. " +
      "Cada ação de mensagem traz o rascunho pronto para preview_mat_messages; pausar vai por preview_meta_changes.",
    input: z.object({
      userId: z.string().uuid(),
      includeLiveChecks: z.boolean().optional().describe("Lê pixel e saldo na Meta agora (um cliente por vez)."),
      days: z.number().int().min(1).max(30).optional().describe("Período dos criativos, em dias completos. Padrão 7."),
    }),
    async run(actor, input) {
      assertClientAccess(actor, input.userId);
      const days = input.days ?? 7;
      const [db, live] = await Promise.all([
        loadSuggestedActions(actor, input.userId, days),
        input.includeLiveChecks ? runLiveChecks(actor, input.userId, { days }) : Promise.resolve(null),
      ]);
      const suggestions = [...db.suggestions, ...(live?.suggestions ?? [])];
      return {
        days,
        suggestions: suggestions.map((suggestion) => describeSuggestion(input.userId, suggestion)),
        liveChecks: live
          ? live.checks.map((check) => ({ check: check.check, status: check.status, summary: check.summary, adAccountId: check.adAccountId, checkedAt: check.checkedAt }))
          : "não pedidas (use includeLiveChecks para pixel e saldo)",
      };
    },
  }),
  defineTool({
    name: "preview_mat_messages",
    title: "Prévia de mensagens da Mat (lote)",
    permission: "mat:outreach",
    write: false,
    description:
      `Prévia de até ${MAX_MESSAGES} mensagens que a Mat (WhatsApp da Automatize) mandaria a clientes: tipo (scale_approval, creative_refresh, offer_suggestion, pixel_setup, ad_balance), ` +
      "título (até 60, uma linha) e mensagem (até 700). scale_approval exige entity da campanha; o cliente aprova no app com um toque. " +
      "Devolve, por item, o texto renderizado, o destinatário mascarado e impedimentos; e um confirmationCode (15 min) quando nada impede. " +
      "MOSTRE a prévia ao usuário e só chame send_mat_messages depois da aprovação explícita, com as MESMAS mensagens. Nada é enviado aqui.",
    input: z.object({ messages: z.array(messageSchema).min(1).max(MAX_MESSAGES) }),
    async run(actor, input) {
      const messages = input.messages as OutreachInput[];
      for (const message of messages) assertClientAccess(actor, message.userId);
      const items = [];
      for (const message of messages) {
        try {
          const preview = await previewOutreach(actor, message);
          const blocking = preview.recipient.available ? null : "Cliente sem WhatsApp para a Mat mandar.";
          items.push({
            userId: message.userId,
            kind: OUTREACH_KIND_LABEL[message.kind],
            to: preview.recipient.masked,
            recipientSource: preview.recipient.source ? RECIPIENT_SOURCE_LABEL[preview.recipient.source] : null,
            title: preview.rendered.title,
            message: preview.rendered.message,
            buttonUrl: preview.rendered.buttonUrl,
            approvalInApp: preview.approval.available ? (preview.approval.actionLabel ?? "o cliente aprova no app com um toque") : null,
            blocking,
          });
        } catch (error) {
          items.push({
            userId: message.userId,
            kind: OUTREACH_KIND_LABEL[message.kind],
            blocking: error instanceof OutreachError ? error.failure.message : errorText(error),
          });
        }
      }
      const blocked = items.filter((item) => item.blocking).length;
      return {
        items,
        ...(blocked
          ? { confirmationCode: null, blockedItems: blocked, hint: "Remova ou corrija as mensagens com impedimento e gere outra prévia." }
          : { confirmationCode: batchConfirmationCode(normalizeOutreachBatch(messages), secret()) }),
      };
    },
  }),
  defineTool({
    name: "send_mat_messages",
    title: "Mandar mensagens pela Mat (lote)",
    permission: "mat:outreach",
    write: true,
    destructive: true,
    description:
      "Manda pela Mat o lote aprovado em preview_mat_messages. Exige o confirmationCode da prévia e EXATAMENTE as mesmas mensagens; só chame depois que o usuário aprovar. " +
      "Envia em sequência; uma mensagem que falhar (ex.: já mandada há pouco) não impede as outras. Cada envio vira nota \"Mat enviou ao cliente\" no histórico.",
    input: z.object({ messages: z.array(messageSchema).min(1).max(MAX_MESSAGES), confirmationCode: z.string() }),
    async run(actor, input) {
      const messages = input.messages as OutreachInput[];
      for (const message of messages) assertClientAccess(actor, message.userId);
      const verdict = verifyBatchConfirmation(input.confirmationCode, normalizeOutreachBatch(messages), secret());
      if (verdict === "expired") throw new Error("A prévia expirou (15 min). Gere outra com preview_mat_messages e mostre ao usuário.");
      if (verdict === "mismatch") throw new Error("As mensagens mudaram desde a prévia aprovada. Gere outra prévia e peça aprovação de novo.");
      const results = [];
      // Em sequência: cada envio sai de verdade pelo WhatsApp; nada de rajada.
      for (const message of messages) {
        try {
          const sent = await sendOutreach(actor, message, "mcp");
          results.push({ userId: message.userId, kind: message.kind, status: "enviada", to: sent.recipient.masked, providerMessageId: sent.providerMessageId ?? null });
        } catch (error) {
          results.push({
            userId: message.userId,
            kind: message.kind,
            status: "falhou",
            error: error instanceof OutreachError ? error.failure.message : errorText(error),
          });
        }
      }
      return {
        sent: results.filter((result) => result.status === "enviada").length,
        failed: results.filter((result) => result.status === "falhou").length,
        results,
      };
    },
  }),
  defineTool({
    name: "suggest_offer",
    title: "Sugerir oferta/combo (IA)",
    permission: "marketing:write",
    write: false,
    description:
      "Para um criativo ruim: a IA lê o negócio, o texto dos anúncios fracos, os melhores anúncios do período e o cardápio (se houver) e sugere 3 ofertas/combos " +
      "(nome, composição, dica de preço — nunca preço inventado —, por que funciona e uma frase de anúncio). Escolhida uma, mande pela Mat com kind offer_suggestion. Limite de 20 por hora.",
    input: z.object({
      userId: z.string().uuid(),
      adIds: z.array(z.string().regex(/^\d{3,30}$/)).max(3).optional().describe("Anúncios fracos (de list_suggested_actions). Sem eles, a regra de criativo ruim escolhe."),
      days: z.number().int().min(1).max(30).optional(),
    }),
    async run(actor, input) {
      assertClientAccess(actor, input.userId);
      return suggestOffers(actor, { userId: input.userId, adIds: input.adIds, days: input.days });
    },
  }),
];
