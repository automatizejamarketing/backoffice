import { hasBackofficePermission, type BackofficeActor, type BackofficePermission } from "@/lib/auth/rbac-core";

/**
 * The "Conectar IA" page and the consent screen: how to connect the backoffice
 * MCP, what it can do and which connections are live. Pure, so the pages, the
 * API route and the tests share the rules.
 */

/** Every role that holds an MCP tool permission also holds this one (see the tests). */
export const MCP_PAGE_PERMISSION: BackofficePermission = "marketing:read";

export const CONNECTOR_NAME = "Backoffice Automatize";
export const CLAUDE_CODE_SERVER_NAME = "backoffice-automatize";

export function mcpServerUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/mcp`;
}

/** Opens Claude's "add custom connector" form with name and address filled in. */
export function claudeConnectorLink(serverUrl: string): string {
  const params = new URLSearchParams({ modal: "add-custom-connector", connectorName: CONNECTOR_NAME, connectorUrl: serverUrl });
  return `https://claude.ai/customize/connectors?${params}`;
}

export function claudeCodeCommand(serverUrl: string): string {
  return `claude mcp add --transport http ${CLAUDE_CODE_SERVER_NAME} ${serverUrl}`;
}

/** A person disconnects their own apps; only whoever manages the team disconnects someone else's. */
export function canDisconnect(actor: BackofficeActor, ownerEmail: string): boolean {
  if (ownerEmail.trim().toLowerCase() === actor.email.trim().toLowerCase()) return hasBackofficePermission(actor, MCP_PAGE_PERMISSION);
  return hasBackofficePermission(actor, "team:manage");
}

export type McpCapability = {
  permission: BackofficePermission;
  title: string;
  examples: string[];
  limit: string;
  /** What the consent screen promises, for read-only and for read-write grants. */
  consent: string[];
  consentWrite?: string[];
};

/** What the connector can do, by the permission its tools check. Mirrors the tools in `lib/mcp`. */
export const MCP_CAPABILITIES: McpCapability[] = [
  {
    permission: "marketing:read",
    title: "Meta Ads dos clientes",
    examples: [
      "Quais clientes da minha carteira pioraram o custo por resultado nos últimos 7 dias?",
      "Compare o ROAS da carteira deste mês com o do mês passado.",
      "Quem da carteira está sem gastar?",
      "Quais alertas críticos estão abertos na minha carteira?",
      "Abra as campanhas do cliente X e mostre os anúncios que mais gastaram.",
    ],
    limit: "Só leitura: a IA não pausa, não ativa e não muda orçamento na Meta.",
    consent: ["Consultar Meta Ads, resultados e alertas dos clientes que você acompanha"],
  },
  {
    permission: "whatsapp:campaigns",
    title: "Campanhas de WhatsApp",
    examples: [
      "Liste as campanhas de WhatsApp agendadas e o resultado da última enviada.",
      "Crie um rascunho de campanha com o botão Falar com a equipe.",
      "Mande um teste da campanha X para o meu número.",
    ],
    limit: "Envio para clientes só acontece depois que você aprova a prévia.",
    consent: ["Consultar campanhas de WhatsApp e resultados"],
    consentWrite: [
      "Criar e editar rascunhos, enviar templates à Meta e mandar testes",
      "Agendar envios, sempre depois de mostrar a prévia e você confirmar",
    ],
  },
];

export function capabilitiesFor(actor: BackofficeActor): McpCapability[] {
  return MCP_CAPABILITIES.filter((c) => hasBackofficePermission(actor, c.permission));
}

/** First message to confirm the connection works; every role on the page can run it. */
export const TEST_PROMPT = "Liste os clientes da minha carteira no backoffice da Automatize.";

/** What the consent screen lists for this person: only areas their role can use. */
export function consentItems(actor: BackofficeActor, canWrite: boolean): string[] {
  return capabilitiesFor(actor).flatMap((c) => [...c.consent, ...(canWrite ? (c.consentWrite ?? []) : [])]);
}

export type AiProvider = "claude" | "chatgpt";

/** Which assistant an OAuth client is, from the name it registered with. */
export function providerOf(clientName: string): AiProvider | null {
  if (/claude|anthropic/i.test(clientName)) return "claude";
  if (/chatgpt|openai/i.test(clientName)) return "chatgpt";
  return null;
}

/** Claude Code registers from the terminal; its mark gets a terminal badge. */
export function isTerminalClient(clientName: string): boolean {
  return /claude[\s_-]*code/i.test(clientName);
}

/** Name to show for a client: the assistant's own name, or what it registered with. */
export function appLabel(clientName: string): string {
  if (isTerminalClient(clientName)) return "Claude Code";
  const provider = providerOf(clientName);
  if (provider === "claude") return "Claude";
  if (provider === "chatgpt") return "ChatGPT";
  return clientName;
}
