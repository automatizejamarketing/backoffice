import { fromJsonSchema, type JsonSchemaType } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import * as z from "zod/v4";
import { getBackofficeActorByEmail } from "@/lib/auth/backoffice-users";
import { hasBackofficePermission } from "@/lib/auth/rbac-core";
import { MCP_SCOPE_WRITE } from "@/lib/mcp-oauth/core";
import type { McpAuthExtra } from "@/lib/mcp-oauth/service";
import { mcpOauthService } from "@/lib/mcp-oauth/store";
import { toCallToolResult, toErrorResult, toolAnnotations } from "@/lib/mcp/tool";
import { META_ADS_TOOLS } from "@/lib/mcp/meta-ads-tools";
import { WHATSAPP_CAMPAIGN_TOOLS } from "@/lib/mcp/whatsapp-campaign-tools";
import { CONSULTANT_WORKSPACE_TOOLS } from "@/lib/mcp/consultant-workspace-tools";
import { checkRateLimit } from "@/lib/security/rate-limit";

/** Media import downloads up to 16 MB and uploads it to R2 and, on submission, to Meta; a client read can hit 5 ad accounts. */
export const maxDuration = 120;

const TOOL_RATE_LIMIT = { limit: 60, windowSeconds: 60 } as const;

const INSTRUCTIONS =
  "Backoffice da Automatize, agindo em nome do colaborador autenticado e com as permissões dele. " +
  "Campanhas de WhatsApp: save_whatsapp_campaign_draft (texto, botão, mídia por link) → submit_whatsapp_template (aprovação da Meta) → " +
  "get_whatsapp_campaign até o template ficar APPROVED → send_whatsapp_campaign_test → set_whatsapp_campaign_audience → " +
  "preview_whatsapp_campaign_send → mostre a prévia e espere o usuário aprovar → confirm_whatsapp_campaign_send. " +
  "Nunca confirme envio, nem escolha horário, sem aprovação explícita do usuário. " +
  "Meta Ads dos clientes: list_my_clients (carteira e saúde), portfolio_performance (todos os clientes de uma vez, período vs anterior), " +
  "list_portfolio_alerts (alertas pendentes) e get_client_campaigns (campanhas, conjuntos ou anúncios de um cliente, ao vivo). " +
  "Para perguntas sobre a carteira comece por portfolio_performance; abra um cliente com get_client_campaigns só quando precisar do detalhe. " +
  "Área de Tráfego (gestor): list_clients_by_stage dá a jornada (onboarding, rodando, parado) com o que trava e o que pede atenção; get_client_dossier abre um cliente com ids para agir. " +
  "Para agir em várias contas: monte um lote em preview_meta_changes, MOSTRE a prévia em tabela curta, espere aprovação explícita e só então apply_meta_changes com as mesmas mudanças e o confirmationCode. Nunca aplique sem aprovação. " +
  "Ao tratar alertas use resolve_alerts com o que foi feito e uma nota real; não conclua alertas só para limpar a fila. " +
  "Mensagens ao cliente: prepare_client_messages devolve texto e link do WhatsApp para o consultor enviar; registre com record_client_messages_sent depois que ele confirmar. " +
  "Ações sugeridas: list_suggested_actions abre as situações de UM cliente (campanha validou, criativo ruim; pixel e saldo ao vivo só com includeLiveChecks) com rascunhos prontos; suggest_offer dá 3 ofertas/combos para o criativo ruim. " +
  "Mensagens pela Mat (WhatsApp da Automatize, chegam ao cliente de verdade): SEMPRE preview_mat_messages primeiro, MOSTRE ao usuário cada mensagem (destinatário mascarado, título, texto, botão) " +
  "e espere aprovação explícita; só então send_mat_messages com as MESMAS mensagens e o confirmationCode. Nunca mande sem aprovação nem troque o texto depois da prévia; se um item falhar por já ter sido mandado há pouco, não insista. " +
  "Valores de WhatsApp em reais. Valores de Meta Ads na moeda da conta: BRL quando o campo currency não vem; nunca some nem converta moedas diferentes. " +
  "Horários de Brasília (-03:00). " +
  "Este conector não traz o financeiro da Automatize (faturamento, receita, MRR, pagamentos): se perguntarem, diga que isso fica na tela Financeiro do backoffice, " +
  "para quem tem acesso, e não estime a partir de outros dados. Receita, compras e ROAS de Meta Ads são vendas dos clientes atribuídas aos anúncios deles, não faturamento da Automatize. " +
  "Quando um campo vier \"restrito ao Financeiro\", diga que a pessoa não tem acesso a esse dado. " +
  "Responda em português do Brasil.";

function inputSchema(schema: z.ZodObject): JsonSchemaType {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete json.$schema;
  return json as JsonSchemaType;
}

const handler = createMcpHandler(
  (server) => {
    for (const tool of [...WHATSAPP_CAMPAIGN_TOOLS, ...META_ADS_TOOLS, ...CONSULTANT_WORKSPACE_TOOLS]) {
      server.registerTool(
        tool.name,
        { title: tool.title, description: tool.description, inputSchema: fromJsonSchema(inputSchema(tool.input)), annotations: toolAnnotations(tool) },
        async (args, ctx) => {
          const auth = ctx.http?.authInfo;
          const extra = auth?.extra as McpAuthExtra | undefined;
          if (!auth || !extra) return toErrorResult("Não autenticado.");
          if (tool.write && !auth.scopes.includes(MCP_SCOPE_WRITE)) return toErrorResult("Esta conexão só tem permissão de leitura.");

          // Re-resolved on every call: removing someone from the backoffice cuts the connector immediately.
          const actor = await getBackofficeActorByEmail(extra.actorEmail);
          if (!actor) return toErrorResult("Seu acesso ao backoffice foi removido.");
          if (!hasBackofficePermission(actor, tool.permission)) return toErrorResult("Seu cargo no backoffice não tem acesso a esta ferramenta.");

          const limit = checkRateLimit(`backoffice-mcp:${actor.email}`, TOOL_RATE_LIMIT);
          if (!limit.success) return toErrorResult(`Muitas chamadas em sequência. Tente de novo em ${limit.retryAfterSeconds}s.`);

          try {
            return toCallToolResult(await tool.run(actor, args));
          } catch (error) {
            return toErrorResult(error);
          }
        },
      );
    }
  },
  {
    serverInfo: { name: "automatize-backoffice", version: "1.0.0" },
    instructions: INSTRUCTIONS,
    onEvent: (event) => {
      if (event.type === "ERROR") console.error("[backoffice-mcp]", event.severity, event.context ?? "", event.error);
    },
  },
);

const authedHandler = withMcpAuth(
  handler,
  async (_request, bearerToken) => (bearerToken ? ((await mcpOauthService.verifyAccessToken(bearerToken)) ?? undefined) : undefined),
  { required: true, resourceMetadataPath: "/.well-known/oauth-protected-resource" },
);

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
