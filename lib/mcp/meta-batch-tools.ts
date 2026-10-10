import "server-only";

import * as z from "zod/v4";
import { approvalUrl, batchAction, getMetaBatch, previewMetaBatch } from "./meta-batch";
import { BATCH_ACTIONS, BATCH_LEVELS, MAX_BATCH_ITEMS } from "./meta-batch-core";
import { defineTool, type McpTool } from "./tool";

const batchId = z.string().uuid().describe("batchId devolvido por preview_meta_batch.");

export const META_BATCH_TOOLS: McpTool[] = [
  defineTool({
    name: "preview_meta_batch", title: "Prévia de ações em lote na Meta Ads", permission: "marketing:write", write: false,
    description:
      `Prepara até ${MAX_BATCH_ITEMS} ações de uma vez em campanhas, conjuntos ou anúncios de vários clientes da carteira: pausar, ativar ou mudar o orçamento diário. ` +
      "Não muda nada na Meta: lê o estado atual de cada objeto, confere que ele é do cliente informado e devolve antes → depois, avisos e itens pulados com o motivo " +
      "(ex.: já pausado; orçamento está nos conjuntos (ABO) ou na campanha (CBO); moeda sem centavos; conta compartilhada com cliente fora da carteira). " +
      "Os ids vêm de get_client_campaigns (ou de list_portfolio_alerts). Orçamento em unidades da moeda da conta (50 = R$ 50,00), sempre o valor final, nunca percentual: calcule antes. " +
      "Devolve approvalUrl: a pessoa abre o backoffice, revisa e aprova, e só então o lote roda. Mostre o resumo e envie o link. A prévia vale 15 minutos.",
    input: z.object({
      items: z.array(z.object({
        userId: z.string().uuid().describe("Cliente dono do objeto."),
        level: z.enum(BATCH_LEVELS),
        id: z.string().regex(/^\d+$/).describe("Id do objeto na Meta."),
        action: z.enum(BATCH_ACTIONS),
        dailyBudget: z.number().positive().optional().describe("Só em set_daily_budget: novo orçamento diário na moeda da conta."),
      })).min(1).max(MAX_BATCH_ITEMS),
      note: z.string().trim().min(5).max(500).describe("Motivo da mudança, registrado no histórico de cada objeto (obrigatório)."),
    }),
    run: (actor, input, ctx) => previewMetaBatch(actor, input, ctx.origin),
  }),
  defineTool({
    name: "get_meta_batch", title: "Resultado de um lote", permission: "marketing:write", write: false,
    description:
      "Situação e resultado item a item de um lote de ações na Meta Ads: previewed (esperando aprovação no backoffice), running, partial ou done. " +
      "nextStep diz o que a pessoa pode fazer agora: approve (aprovar pelo approvalUrl), resume (continuar pelo approvalUrl) ou nada (concluído, em execução ou vencido: gere outra prévia). " +
      "Itens: applied, already_applied, changed_since_preview (alguém mexeu depois da prévia; não sobrescrevemos) ou failed.",
    input: z.object({ batchId }),
    async run(actor, input, ctx) {
      const { row, described } = await getMetaBatch(actor, input.batchId);
      const nextStep = batchAction(row);
      return nextStep ? { ...described, nextStep, approvalUrl: approvalUrl(ctx.origin, row.id) } : { ...described, nextStep: null };
    },
  }),
];
