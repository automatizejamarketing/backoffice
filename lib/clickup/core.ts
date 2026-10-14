import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Núcleo puro da Postagem pelo ClickUp (ADR 0043/0045): sem banco nem rede, para testar as regras.
 * A Lista de Publicação da agência tem um post por tarefa; o Campo Cliente (dropdown) diz de qual
 * Cliente da Agência é; arte, legenda e horário vêm de campos; o tipo de tarefa define o formato.
 */

export type PostFormat = "post" | "reels";

export type ClickupMapping = {
  listId: string;
  listName: string;
  /** Dropdown que identifica o cliente. */
  clientFieldId: string;
  /** Campo de arquivo com a arte; null = anexos normais da tarefa. */
  mediaFieldId: string | null;
  captionFieldId: string;
  /** Campo de data com hora de publicação. */
  publishAtFieldId: string;
  /** `custom_item_id` da tarefa ("0" = tarefa comum) → formato; tipo fora daqui é ignorado. */
  formats: Record<string, PostFormat>;
  statuses: { approval: string; scheduled: string; published: string; error: string | null };
  /** Id da opção do Campo Cliente → conta do cliente (`users.id`). Pelo id, renomear não quebra. */
  clientOptions: Record<string, string>;
};

type DropdownOption = { id: string; name?: string; orderindex?: number | string };

export type ClickupCustomField = {
  id: string;
  name?: string;
  type: string;
  value?: unknown;
  type_config?: { options?: DropdownOption[] };
};

export type ClickupAttachment = { url: string; mimetype?: string | null; extension?: string | null; title?: string | null };

export type ClickupTask = {
  id: string;
  name: string;
  url?: string;
  status: { status: string };
  custom_item_id?: number | null;
  list?: { id: string };
  custom_fields?: ClickupCustomField[];
  attachments?: ClickupAttachment[];
};

export type MediaRef = { url: string; kind: "image" | "video" };

export type TaskDecision =
  | { kind: "ignore"; why: string }
  | { kind: "refuse"; reasons: string[] }
  | { kind: "schedule"; userId: string; format: PostFormat; caption: string; publishAt: Date; media: MediaRef[] };

/** Conta do cliente pronta para publicar? Vem do banco; aqui só a decisão. */
export type ClientReadiness = { ready: true; instagramUsername: string } | { ready: false; reason: string };

export const MAX_CAROUSEL_ITEMS = 10;
/** Folga mínima entre a aprovação e o horário, para baixar a mídia e o cron pegar. */
export const MIN_LEAD_MS = 5 * 60_000;
/** Legenda do Instagram: até 2.200 caracteres. */
export const MAX_CAPTION = 2200;

/** `X-Signature` = HMAC-SHA256 hex do corpo cru com o segredo do webhook. */
export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const given = Buffer.from(signature.trim().toLowerCase(), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * Id da opção escolhida num dropdown. O GET da tarefa devolve o `orderindex` e o webhook devolve
 * o id da opção, então aceitamos os dois e traduzimos pelas opções do próprio campo.
 */
export function dropdownOptionId(field: ClickupCustomField | undefined): string | null {
  if (!field || field.value === undefined || field.value === null || field.value === "") return null;
  const options = field.type_config?.options ?? [];
  const raw = field.value;
  const byId = options.find((o) => o.id === raw);
  if (byId) return byId.id;
  const byIndex = options.find((o) => o.orderindex !== undefined && Number(o.orderindex) === Number(raw));
  return byIndex?.id ?? null;
}

const field = (task: ClickupTask, id: string | null) => (id ? task.custom_fields?.find((f) => f.id === id) : undefined);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Data do ClickUp: epoch em ms, como número ou string. */
export function parseClickupDate(value: unknown): Date | null {
  const ms = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
}

const IMAGE = /^image\/(jpe?g|png)$/i;
const VIDEO = /^video\/(mp4|quicktime)$/i;
const IMAGE_EXT = /^(jpe?g|png)$/i;
const VIDEO_EXT = /^(mp4|mov)$/i;

function mediaKind(attachment: ClickupAttachment): MediaRef["kind"] | null {
  const mime = attachment.mimetype ?? "";
  const ext = (attachment.extension ?? attachment.url.split("?")[0]?.split(".").pop() ?? "").replace(/^\./, "");
  if (IMAGE.test(mime) || IMAGE_EXT.test(ext)) return "image";
  if (VIDEO.test(mime) || VIDEO_EXT.test(ext)) return "video";
  return null;
}

/** Arte da tarefa: o campo de arquivo mapeado (lista de anexos) ou os anexos da tarefa. */
export function taskAttachments(task: ClickupTask, mapping: Pick<ClickupMapping, "mediaFieldId">): ClickupAttachment[] {
  if (!mapping.mediaFieldId) return task.attachments ?? [];
  const value = field(task, mapping.mediaFieldId)?.value;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const url = text(record.url) || text(record.url_w_query);
    if (!url) return [];
    return [{ url, mimetype: text(record.mimetype) || text(record.mime_type) || null, extension: text(record.extension) || null, title: text(record.title) || null }];
  });
}

/**
 * O que fazer com uma tarefa que entrou no Status de Aprovação. Recusa lista tudo o que falta de
 * uma vez, em português, para o Retorno na Tarefa.
 */
export function decideTask(
  task: ClickupTask,
  mapping: ClickupMapping,
  readiness: (userId: string) => ClientReadiness,
  now: Date,
): TaskDecision {
  const format = mapping.formats[String(task.custom_item_id ?? 0)];
  if (!format) return { kind: "ignore", why: "tipo de tarefa fora da publicação" };

  const reasons: string[] = [];
  const optionId = dropdownOptionId(field(task, mapping.clientFieldId));
  const userId = optionId ? mapping.clientOptions[optionId] : undefined;
  if (!optionId) reasons.push("Escolha o cliente no campo Cliente.");
  else if (!userId) reasons.push("Este cliente ainda não está ligado no Automatize. Peça ao Dono da agência para ligar a opção.");

  const ready = userId ? readiness(userId) : null;
  if (ready && !ready.ready) reasons.push(ready.reason);

  const caption = text(field(task, mapping.captionFieldId)?.value);
  if (caption.length > MAX_CAPTION) reasons.push(`A legenda passa de ${MAX_CAPTION} caracteres (tem ${caption.length}).`);

  const publishAt = parseClickupDate(field(task, mapping.publishAtFieldId)?.value);
  if (!publishAt) reasons.push("Preencha o horário de publicação.");
  else if (publishAt.getTime() < now.getTime() + MIN_LEAD_MS) reasons.push("O horário de publicação precisa estar pelo menos 5 minutos no futuro.");

  const attachments = taskAttachments(task, mapping);
  const media: MediaRef[] = [];
  const unknown: string[] = [];
  for (const attachment of attachments) {
    const kind = mediaKind(attachment);
    if (kind) media.push({ url: attachment.url, kind });
    else unknown.push(attachment.title ?? attachment.url.split("/").pop() ?? "arquivo");
  }
  if (unknown.length) reasons.push(`Formato não aceito: ${unknown.join(", ")}. Use JPG ou PNG (post) e MP4 ou MOV (Reels).`);
  if (format === "post") {
    if (media.length === 0) reasons.push("Anexe a arte (JPG ou PNG).");
    else if (media.some((m) => m.kind !== "image")) reasons.push("Post aceita só imagens; vídeo vai como Reels.");
    else if (media.length > MAX_CAROUSEL_ITEMS) reasons.push(`Carrossel aceita até ${MAX_CAROUSEL_ITEMS} imagens (tem ${media.length}).`);
  } else if (media.length !== 1 || media[0]?.kind !== "video") {
    reasons.push("Reels precisa de exatamente um vídeo (MP4 ou MOV).");
  }

  if (reasons.length) return { kind: "refuse", reasons };
  return { kind: "schedule", userId: userId!, format, caption, publishAt: publishAt!, media };
}

/** Mudança de status num item do histórico do webhook (`field: "status"`). */
export type StatusChange = { taskId: string; historyId: string; from: string | null; to: string | null; at: Date; userId: string | null };

type HistoryItem = { id?: unknown; field?: unknown; date?: unknown; before?: unknown; after?: unknown; user?: { id?: unknown } | null };

const statusName = (value: unknown) =>
  value && typeof value === "object" && typeof (value as { status?: unknown }).status === "string"
    ? ((value as { status: string }).status)
    : null;

export function statusChanges(payload: { task_id?: unknown; history_items?: unknown }): StatusChange[] {
  const taskId = typeof payload.task_id === "string" ? payload.task_id : null;
  if (!taskId || !Array.isArray(payload.history_items)) return [];
  return (payload.history_items as HistoryItem[]).flatMap((item) => {
    if (item.field !== "status" || (typeof item.id !== "string" && typeof item.id !== "number")) return [];
    const userId = item.user && (typeof item.user.id === "number" || typeof item.user.id === "string") ? String(item.user.id) : null;
    return [{ taskId, historyId: String(item.id), from: statusName(item.before), to: statusName(item.after), at: parseClickupDate(item.date) ?? new Date(), userId }];
  });
}

const same = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** O que uma mudança de status pede: agendar, cancelar ou nada. */
export function statusIntent(change: StatusChange, statuses: ClickupMapping["statuses"]): "schedule" | "cancel" | null {
  if (same(change.to, statuses.approval)) return "schedule";
  // Uma pessoa tirou do Agendado para outro lugar que não seja Publicado/Erro: cancela.
  if (same(change.from, statuses.scheduled) && !same(change.to, statuses.published) && !same(change.to, statuses.error)) return "cancel";
  return null;
}

/** Eco de uma escrita nossa: mesmo status na mesma tarefa, até 2 min depois de escrevermos. */
export function isOwnEcho(change: StatusChange, ownWrites: Array<{ taskId: string; status: string; at: Date }>): boolean {
  return ownWrites.some((w) => w.taskId === change.taskId && same(w.status, change.to) && Math.abs(change.at.getTime() - w.at.getTime()) < 120_000);
}

const BRT = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function formatBrasilia(date: Date): string {
  const parts = Object.fromEntries(BRT.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.day}/${parts.month} às ${parts.hour}:${parts.minute} (Brasília)`;
}

/** Textos do Retorno na Tarefa. */
export const feedback = {
  refused: (reasons: string[]) => `Automatize: não deu para agendar.\n${reasons.map((r) => `• ${r}`).join("\n")}`,
  scheduled: (publishAt: Date, username: string, format: PostFormat) =>
    `Automatize: ${format === "reels" ? "Reels agendado" : "post agendado"} para ${formatBrasilia(publishAt)} no @${username}.`,
  published: (permalink: string | null) => `Automatize: publicado${permalink ? `: ${permalink}` : "."}`,
  failed: (reason: string) => `Automatize: a publicação falhou. ${reason}`,
  cancelled: () => "Automatize: agendamento cancelado porque a tarefa saiu do status de agendado.",
};
