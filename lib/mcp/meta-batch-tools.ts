import "server-only";

import * as z from "zod/v4";
import { confirmMetaBatch, getMetaBatch, previewMetaBatch } from "./meta-batch";
import { BATCH_ACTIONS, BATCH_LEVELS, MAX_BATCH_ITEMS } from "./meta-batch-core";
import { defineTool, type McpTool } from "./tool";

const batchId = z.string().uuid().describe("batchId devolvido por preview_meta_batch.");

export const META_BATCH_TOOLS: McpTool[] = [
  defineTool({
    name: "preview_meta_batch", title: "Prévia de ações em lote na Meta Ads", permission: "marketing:write", write: false,
    description:
      `Prepara até ${MAX_BATCH_ITEMS} ações de uma vez em campanhas, conjuntos ou anúncios de vários clientes da carteira: pausar, ativar ou mudar o orçamento diário. ` +
      "Não muda nada na Meta: lê o estado atual de cada objeto, confere que ele é do cliente informado e devolve antes → depois, avisos e itens pulados com o motivo " +
      "(ex.: já pausado; orçamento está nos conjuntos (ABO) ou na campanha (CBO); moeda sem centavos). " +
      "Os ids vêm de get_client_campaigns (ou de list_portfolio_alerts). Orçamento em unidades da moeda da conta (50 = R$ 50,00), sempre o valor final, nunca percentual: calcule antes. " +
      "Mostre a prévia ao usuário e espere aprovação explícita antes de confirm_meta_batch. A prévia vale 15 minutos.",
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
    run: (actor, input) => previewMetaBatch(actor, input),
  }),
  defineTool({
    name: "confirm_meta_batch", title: "Executar ações em lote na Meta Ads", permission: "marketing:write", write: true, destructive: true,
    description:
      "Executa na Meta o lote de uma prévia, só depois de aprovação explícita do usuário. Relê cada objeto antes de escrever: se alguém mexeu nele depois da prévia, " +
      "o item é pulado (changed_since_preview) em vez de sobrescrever. Cada mudança fica no histórico do objeto com o motivo. " +
      "Se o tempo da chamada acabar, o lote fica parcial: chame de novo com o mesmo batchId para continuar.",
    input: z.object({ batchId }),
    run: (actor, input) => confirmMetaBatch(actor, input.batchId),
  }),
  defineTool({
    name: "get_meta_batch", title: "Resultado de um lote", permission: "marketing:write", write: false,
    description: "Situação e resultado item a item de um lote de ações na Meta Ads (prévia, em execução, parcial ou concluído).",
    input: z.object({ batchId }),
    run: (actor, input) => getMetaBatch(actor, input.batchId),
  }),
];
