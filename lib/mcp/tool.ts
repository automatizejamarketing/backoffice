import * as z from "zod/v4";
import type { BackofficeActor, BackofficePermission } from "@/lib/auth/rbac-core";

/** O que a chamada sabe além do ator: a origem pública, para links de volta ao backoffice. */
export type McpToolContext = { origin: string };

/** One backoffice capability exposed over MCP; `permission` is the same RBAC check the screen uses. */
export type McpTool = {
  name: string;
  title: string;
  description: string;
  permission: BackofficePermission;
  /** Writes need the backoffice:write scope; read-only tools run without client confirmation. */
  write: boolean;
  destructive?: boolean;
  input: z.ZodObject;
  run(actor: BackofficeActor, input: unknown, ctx: McpToolContext): Promise<unknown>;
};

export function defineTool<S extends z.ZodObject>(
  tool: Omit<McpTool, "input" | "run"> & { input: S; run(actor: BackofficeActor, input: z.infer<S>, ctx: McpToolContext): Promise<unknown> },
): McpTool {
  return { ...tool, run: (actor, input, ctx) => tool.run(actor, tool.input.parse(input), ctx) };
}

export function toolAnnotations(tool: McpTool) {
  return { title: tool.title, readOnlyHint: !tool.write, destructiveHint: Boolean(tool.destructive), idempotentHint: !tool.write, openWorldHint: true };
}

export function toCallToolResult(result: unknown) {
  const structured = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : undefined;
  return { content: [{ type: "text" as const, text: JSON.stringify(result ?? null) }], ...(structured ? { structuredContent: structured } : {}) };
}

export function toErrorResult(error: unknown) {
  // Domain code still validates with zod v3, so match any ZodError by shape.
  const issues = error && typeof error === "object" && "issues" in error && Array.isArray(error.issues) ? (error.issues as { path: PropertyKey[]; message: string }[]) : null;
  const message = issues ? issues.map(i => `${i.path.map(String).join(".") || "entrada"}: ${i.message}`).join("; ") : error instanceof Error ? error.message : String(error);
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}
