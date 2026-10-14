import "server-only";
import { canAccessMarketingUser, hasBackofficePermission, type BackofficeActor } from "@/lib/auth/rbac-core";
import { checkRateLimit } from "@/lib/security/rate-limit";
import {
  buildOutreachRequestBody,
  mapOutreachError,
  MAT_TEMPLATE_PREFIX,
  outreachInputSchema,
  outreachResponseSchema,
  type OutreachFailure,
  type OutreachInput,
  type OutreachMode,
  type OutreachResult,
} from "./outreach-core";
import { applyWorkspaceOp } from "./state";

/**
 * Mensagem da Mat ao cliente, pedida pelo gestor (tela ou MCP).
 *
 * O backoffice só autoriza e encaminha servidor a servidor ao app, que é dono
 * do WhatsApp (número, template, deduplicação). O navegador nunca vê o
 * segredo. Envio confirmado vira nota "Mat enviou ao cliente" na linha do
 * tempo.
 */

const FRONTEND_TIMEOUT_MS = 20_000;
/** Teto de envios por gestor: protege contra rajada por engano (o app ainda deduplica por cliente). */
const SEND_RATE_LIMIT = { limit: 60, windowSeconds: 3600 };

export class OutreachError extends Error {
  constructor(readonly failure: OutreachFailure) {
    super(failure.message);
  }
}

function fail(failure: OutreachFailure): never {
  throw new OutreachError(failure);
}

function assertCanSend(actor: BackofficeActor, userId: string) {
  if (!hasBackofficePermission(actor, "mat:outreach")) {
    fail({ code: "forbidden", status: 403, message: "Seu cargo não pode mandar mensagens aos clientes pela Mat." });
  }
  if (!canAccessMarketingUser(actor, userId)) {
    fail({ code: "forbidden", status: 403, message: "Este cliente não está na sua carteira." });
  }
}

export function parseOutreachInput(raw: unknown): OutreachInput {
  const parsed = outreachInputSchema.safeParse(raw);
  if (!parsed.success) {
    fail({
      code: "invalid_input",
      status: 400,
      message: parsed.error.issues.map((issue) => issue.message).join(" · "),
    });
  }
  return parsed.data;
}

async function callFrontend(actor: BackofficeActor, mode: OutreachMode, input: OutreachInput): Promise<OutreachResult> {
  const secret = process.env.FRONTEND_CRON_SECRET ?? process.env.CRON_SECRET;
  const frontendUrl = (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/$/, "");
  if (!secret) fail({ code: "not_configured", status: 500, message: "FRONTEND_CRON_SECRET não configurado no backoffice." });

  let response: Response;
  try {
    response = await fetch(`${frontendUrl}/api/internal/consultant-outreach`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify(buildOutreachRequestBody(mode, input, actor.email)),
      cache: "no-store",
      signal: AbortSignal.timeout(FRONTEND_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    console.error("backoffice.consultant_outreach.unreachable", { mode, userId: input.userId, kind: input.kind, timedOut });
    fail({
      code: "timeout",
      status: 504,
      message:
        mode === "send"
          ? "O app não respondeu a tempo. A mensagem PODE ter saído — confira o histórico do cliente antes de tentar de novo."
          : "O app não respondeu a tempo. Tente a prévia de novo.",
    });
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  console.info("backoffice.consultant_outreach", {
    mode,
    userId: input.userId,
    kind: input.kind,
    operator: actor.email,
    status: response.status,
  });
  if (!response.ok) fail(mapOutreachError(response.status, payload, mode));
  const parsed = outreachResponseSchema.safeParse(payload);
  if (!parsed.success) {
    fail({
      code: "unexpected",
      status: 502,
      message:
        mode === "send"
          ? "O app respondeu num formato inesperado. Confira o histórico do cliente antes de tentar de novo."
          : "O app respondeu num formato inesperado.",
    });
  }
  return parsed.data;
}

/** Prévia: o que a Mat mandaria, para quem (mascarado) e se o cliente aprova no app. Não envia nada. */
export async function previewOutreach(actor: BackofficeActor, raw: unknown): Promise<OutreachResult> {
  const input = parseOutreachInput(raw);
  assertCanSend(actor, input.userId);
  return callFrontend(actor, "preview", input);
}

/** Envia pela Mat e registra na linha do tempo do cliente. */
export async function sendOutreach(
  actor: BackofficeActor,
  raw: unknown,
  source: "backoffice" | "mcp",
): Promise<OutreachResult> {
  const input = parseOutreachInput(raw);
  assertCanSend(actor, input.userId);
  const limit = checkRateLimit(`consultant-outreach-send:${actor.email}`, SEND_RATE_LIMIT);
  if (!limit.success) {
    fail({
      code: "rate_limited",
      status: 429,
      message: `Limite de ${SEND_RATE_LIMIT.limit} mensagens pela Mat por hora atingido. Tente em ${Math.ceil(limit.retryAfterSeconds / 60)} min.`,
    });
  }
  const result = await callFrontend(actor, "send", input);
  try {
    await applyWorkspaceOp(
      actor,
      {
        op: "sendMessage",
        userId: input.userId,
        templateKey: `${MAT_TEMPLATE_PREFIX}${input.kind}`,
        text: `${input.title} — ${input.message}`,
      },
      source,
    );
  } catch (error) {
    // A mensagem já saiu: falhar aqui faria o gestor reenviar. Só registra o erro.
    console.error("backoffice.consultant_outreach.timeline_failed", { userId: input.userId, kind: input.kind, error });
  }
  return result;
}
