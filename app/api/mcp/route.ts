import { fromJsonSchema, type JsonSchemaType } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import * as z from "zod/v4";
import { getBackofficeActorByEmail } from "@/lib/auth/backoffice-users";
import { hasBackofficePermission } from "@/lib/auth/rbac-core";
import { MCP_SCOPE_WRITE } from "@/lib/mcp-oauth/core";
import type { McpAuthExtra } from "@/lib/mcp-oauth/service";
import { mcpOauthService } from "@/lib/mcp-oauth/store";
import { toCallToolResult, toErrorResult, toolAnnotations } from "@/lib/mcp/tool";
import { WHATSAPP_CAMPAIGN_TOOLS } from "@/lib/mcp/whatsapp-campaign-tools";
import { checkRateLimit } from "@/lib/security/rate-limit";

/** Media import downloads up to 16 MB and uploads it to R2 and, on submission, to Meta. */
export const maxDuration = 120;

const TOOL_RATE_LIMIT = { limit: 60, windowSeconds: 60 } as const;

const INSTRUCTIONS =
  "Backoffice da Automatize, agindo em nome do colaborador autenticado e com as permissões dele. " +
  "Campanhas de WhatsApp: save_whatsapp_campaign_draft (texto, botão, mídia por link) → submit_whatsapp_template (aprovação da Meta) → " +
  "get_whatsapp_campaign até o template ficar APPROVED → send_whatsapp_campaign_test → set_whatsapp_campaign_audience → " +
  "preview_whatsapp_campaign_send → mostre a prévia e espere o usuário aprovar → confirm_whatsapp_campaign_send. " +
  "Nunca confirme envio, nem escolha horário, sem aprovação explícita do usuário. Valores em reais; horários de Brasília (-03:00). " +
  "Responda em português do Brasil.";

function inputSchema(schema: z.ZodObject): JsonSchemaType {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete json.$schema;
  return json as JsonSchemaType;
}

const handler = createMcpHandler(
  (server) => {
    for (const tool of WHATSAPP_CAMPAIGN_TOOLS) {
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
