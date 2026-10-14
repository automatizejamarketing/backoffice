/**
 * Mensagens que a Mat (assistente da Automatize no WhatsApp) manda ao cliente
 * a pedido do gestor — a parte pura: tipos, validação da entrada, o corpo do
 * contrato com o app e a tradução de cada erro para o gestor.
 *
 * O envio real mora no app (`POST /api/internal/consultant-outreach`), que
 * escolhe o número, renderiza o template genérico (`proactivity_alert_v1`:
 * título + mensagem + botão que abre o app) e evita repetir mensagem. Aqui só
 * se monta o pedido e se lê a resposta; quem chama a rede é `outreach.ts`.
 */
import * as z from "zod/v4";

export const OUTREACH_KINDS = [
  "scale_approval",
  "creative_refresh",
  "offer_suggestion",
  "pixel_setup",
  "ad_balance",
] as const;

export type OutreachKind = (typeof OUTREACH_KINDS)[number];

export const OUTREACH_KIND_LABEL: Record<OutreachKind, string> = {
  scale_approval: "Pedido de aprovação para escalar",
  creative_refresh: "Pedido de criativos novos",
  offer_suggestion: "Sugestão de oferta/combo",
  pixel_setup: "Instruções do pixel",
  ad_balance: "Saldo / pagamento na Meta",
};

export const OUTREACH_TITLE_MAX = 60;
export const OUTREACH_MESSAGE_MAX = 700;

/** Prefixo do `templateKey` da nota na linha do tempo: marca o canal Mat. */
export const MAT_TEMPLATE_PREFIX = "mat:";

export function isMatTemplateKey(templateKey: string | null | undefined): boolean {
  return typeof templateKey === "string" && templateKey.startsWith(MAT_TEMPLATE_PREFIX);
}

/** Rótulo do tipo a partir do `templateKey` da nota (`mat:ad_balance` → "Saldo / pagamento na Meta"). */
export function matKindLabel(templateKey: string): string {
  const kind = templateKey.slice(MAT_TEMPLATE_PREFIX.length) as OutreachKind;
  return OUTREACH_KIND_LABEL[kind] ?? "mensagem";
}

export const outreachEntitySchema = z.object({
  level: z.enum(["campaign", "adset", "ad"]),
  id: z.string().trim().regex(/^\d{3,30}$/, "Id da Meta inválido"),
  name: z.string().trim().max(200).optional(),
  adAccountId: z
    .string()
    .trim()
    .regex(/^act_\d{3,30}$/, "Conta deve ser act_…")
    .optional(),
});

export type OutreachEntity = z.infer<typeof outreachEntitySchema>;

export const outreachInputSchema = z
  .object({
    userId: z.string().uuid(),
    kind: z.enum(OUTREACH_KINDS),
    title: z
      .string()
      .trim()
      .min(1, "Escreva o título")
      .max(OUTREACH_TITLE_MAX, `Título com até ${OUTREACH_TITLE_MAX} caracteres`)
      .refine((value) => !/[\r\n]/.test(value), "O título é uma linha só"),
    message: z
      .string()
      .trim()
      .min(1, "Escreva a mensagem")
      .max(OUTREACH_MESSAGE_MAX, `Mensagem com até ${OUTREACH_MESSAGE_MAX} caracteres`),
    entity: outreachEntitySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "scale_approval" && value.entity?.level !== "campaign") {
      ctx.addIssue({
        code: "custom",
        path: ["entity"],
        message: "Pedir aprovação para escalar exige a campanha (entity.level = campaign).",
      });
    }
  });

export type OutreachInput = z.infer<typeof outreachInputSchema>;

export type OutreachMode = "preview" | "send";

/** Corpo do contrato com o app. `consultantEmail` vem sempre do ator, nunca do navegador. */
export function buildOutreachRequestBody(mode: OutreachMode, input: OutreachInput, consultantEmail: string) {
  return {
    mode,
    userId: input.userId,
    kind: input.kind,
    title: input.title,
    message: input.message,
    consultantEmail,
    ...(input.entity ? { entity: input.entity } : {}),
  };
}

const recipientSourceSchema = z.enum(["whatsapp_link", "user_phone", "override"]).nullable();

/** Resposta 200 do app. Campos a mais passam; os que a tela usa são conferidos. */
export const outreachResponseSchema = z.object({
  ok: z.literal(true),
  mode: z.enum(["preview", "send"]),
  recipient: z.object({
    available: z.boolean(),
    source: recipientSourceSchema.optional().default(null),
    masked: z.string().nullable().optional().default(null),
  }),
  rendered: z.object({
    title: z.string(),
    message: z.string(),
    buttonUrl: z.string().nullable().optional().default(null),
    template: z.string().nullable().optional().default(null),
  }),
  approval: z
    .object({ available: z.boolean(), actionLabel: z.string().nullable().optional().default(null) })
    .optional()
    .default({ available: false, actionLabel: null }),
  signalId: z.string().nullable().optional(),
  providerMessageId: z.string().nullable().optional(),
});

export type OutreachResult = z.infer<typeof outreachResponseSchema>;

export const RECIPIENT_SOURCE_LABEL: Record<"whatsapp_link" | "user_phone" | "override", string> = {
  whatsapp_link: "WhatsApp vinculado à Mat",
  user_phone: "telefone do cadastro",
  override: "número de teste",
};

export type OutreachErrorCode =
  | "invalid_input"
  | "unauthorized"
  | "forbidden"
  | "user_not_found"
  | "no_recipient"
  | "recently_sent"
  | "whatsapp_not_configured"
  | "provider_error"
  | "not_configured"
  | "timeout"
  | "rate_limited"
  | "unexpected";

export type OutreachFailure = {
  code: OutreachErrorCode;
  /** Status HTTP que o backoffice devolve à tela. */
  status: number;
  message: string;
  lastSentAt?: string | null;
  detail?: string | null;
};

const formatDateTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

/**
 * Traduz a resposta de erro do app para o gestor. Cada código do contrato tem
 * uma frase que diz o que aconteceu e o que fazer; o resto vira "inesperado".
 */
export function mapOutreachError(status: number, body: unknown, mode: OutreachMode = "send"): OutreachFailure {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const error = typeof record.error === "string" ? record.error : null;
  const detail = typeof record.detail === "string" ? record.detail.slice(0, 300) : null;

  if (status === 401) {
    return {
      code: "unauthorized",
      status: 502,
      message: "O app recusou o backoffice (segredo FRONTEND_CRON_SECRET diferente nos dois). Avise o time de produto.",
    };
  }
  if (status === 404) {
    return { code: "user_not_found", status: 404, message: "O app não encontrou este cliente." };
  }
  if (status === 409 && error === "recently_sent") {
    const lastSentAt = typeof record.lastSentAt === "string" ? record.lastSentAt : null;
    const when = lastSentAt ? formatDateTime(lastSentAt) : null;
    return {
      code: "recently_sent",
      status: 409,
      lastSentAt,
      message: `A Mat já mandou uma mensagem parecida para este cliente${when ? ` em ${when}` : " há pouco"}. Para não insistir, espere a resposta dele ou fale pelo seu WhatsApp.`,
    };
  }
  if (status === 409) {
    return {
      code: "no_recipient",
      status: 409,
      message: "O cliente não tem WhatsApp cadastrado para a Mat mandar. Peça o número ou use \"Abrir no WhatsApp\".",
    };
  }
  if (status === 422) {
    return {
      code: "whatsapp_not_configured",
      status: 422,
      message: "O WhatsApp da Automatize não está configurado neste ambiente — nada foi enviado.",
    };
  }
  if (status === 502) {
    return {
      code: "provider_error",
      status: 502,
      detail,
      message: `O WhatsApp recusou o envio${detail ? ` (${detail})` : ""}. Nada foi enviado; tente de novo em alguns minutos.`,
    };
  }
  if (status === 400) {
    return {
      code: "invalid_input",
      status: 400,
      message: `O app recusou a mensagem${error ? `: ${error}` : ""}. Revise título e texto.`,
    };
  }
  return {
    code: "unexpected",
    status: 502,
    detail,
    message:
      mode === "send"
        ? `O app respondeu ${status} ao envio. Confira o histórico do cliente antes de tentar de novo.`
        : `O app respondeu ${status} à prévia. Tente de novo em instantes.`,
  };
}

/**
 * Lote normalizado das mensagens do MCP: o que o código de confirmação
 * amarra. Mudou cliente, tipo, texto ou entidade → outro código.
 */
export function normalizeOutreachBatch(messages: OutreachInput[]) {
  return messages.map((message) => [
    message.userId,
    message.kind,
    message.title.trim(),
    message.message.trim(),
    message.entity ? [message.entity.level, message.entity.id, message.entity.adAccountId ?? null] : null,
  ]);
}
