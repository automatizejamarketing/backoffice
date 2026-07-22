/**
 * Reduces the append-only `conversation_events` log into a readable transcript
 * (ADR 0018). The writer stores Eve's stream events verbatim; this is where they
 * become dialogue + action cards.
 *
 * Defensive by contract: unknown event types are ignored rather than thrown on,
 * so upgrading Eve degrades the transcript instead of breaking the page.
 */

/**
 * The synthetic per-turn context message the web widget injects. Exported
 * because `listUserConversations` re-states this rule in SQL to count messages
 * without loading payloads — the two must agree.
 */
export const CLIENT_CONTEXT_PREFIX = "Client context:";

export type ActionStatus = "pending" | "completed" | "failed" | "rejected";

export type TranscriptItem =
  | { kind: "user-message"; id: string; at: Date; text: string }
  | { kind: "assistant-message"; id: string; at: Date; text: string }
  | { kind: "client-context"; id: string; at: Date; data: unknown }
  | {
      kind: "action";
      id: string;
      at: Date;
      callId: string;
      toolName: string;
      input: unknown;
      status: ActionStatus;
      /** True once Mat asked the user to approve this call. */
      approvalRequested: boolean;
      output?: unknown;
      error?: { code?: string; message?: string };
      /** Any event feeding this card had its payload clipped. */
      truncated: boolean;
    }
  | { kind: "turn-failed"; id: string; at: Date; message: string };

export type ConversationEventRow = {
  id: number | string;
  type: string;
  turnId: string | null;
  seq: number | null;
  payload: unknown;
  truncated: boolean;
  createdAt: Date;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isClientContext(text: string): boolean {
  return text.trimStart().startsWith(CLIENT_CONTEXT_PREFIX);
}

function parseClientContext(text: string): unknown {
  const body = text.slice(text.indexOf(CLIENT_CONTEXT_PREFIX) + CLIENT_CONTEXT_PREFIX.length);
  try {
    return JSON.parse(body.trim()) as unknown;
  } catch {
    return body.trim();
  }
}

/**
 * `actions.requested` carries a batch; only tool calls become cards (a
 * subagent/skill call is not something the consultant acts on).
 */
function toolCallsOf(payload: unknown): Array<{
  callId: string;
  toolName: string;
  input: unknown;
}> {
  const actions = asRecord(payload).actions;
  if (!Array.isArray(actions)) return [];

  return actions.flatMap((raw) => {
    const action = asRecord(raw);
    const callId = asString(action.callId);
    const toolName = asString(action.toolName);
    if (!callId || !toolName || action.kind !== "tool-call") return [];
    return [{ callId, toolName, input: action.input }];
  });
}

/**
 * Builds the transcript. Action cards are created where the tool call was
 * requested and mutated in place as approval + result events arrive, so the
 * card sits at the point in the dialogue where Mat decided to act.
 */
export function buildTranscript(
  events: readonly ConversationEventRow[],
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const actionsByCallId = new Map<string, Extract<TranscriptItem, { kind: "action" }>>();

  for (const event of events) {
    const id = String(event.id);
    const at = event.createdAt;
    const payload = asRecord(event.payload);

    switch (event.type) {
      case "message.received": {
        const text = asString(payload.message);
        if (!text || text.trim().length === 0) break;
        if (isClientContext(text)) {
          items.push({ kind: "client-context", id, at, data: parseClientContext(text) });
        } else {
          items.push({ kind: "user-message", id, at, text });
        }
        break;
      }

      case "message.completed": {
        const text = asString(payload.message);
        // A step that only requested tools carries no visible message.
        if (!text || text.trim().length === 0) break;
        items.push({ kind: "assistant-message", id, at, text });
        break;
      }

      case "actions.requested": {
        for (const call of toolCallsOf(payload)) {
          const card: Extract<TranscriptItem, { kind: "action" }> = {
            kind: "action",
            id: `${id}:${call.callId}`,
            at,
            callId: call.callId,
            toolName: call.toolName,
            input: call.input,
            status: "pending",
            approvalRequested: false,
            truncated: event.truncated,
          };
          actionsByCallId.set(call.callId, card);
          items.push(card);
        }
        break;
      }

      case "input.requested": {
        const requests = payload.requests;
        if (!Array.isArray(requests)) break;
        for (const raw of requests) {
          const action = asRecord(asRecord(raw).action);
          const callId = asString(action.callId);
          if (!callId) continue;

          const existing = actionsByCallId.get(callId);
          if (existing) {
            existing.approvalRequested = true;
            existing.truncated ||= event.truncated;
            continue;
          }
          // Approval seen without its `actions.requested` (clipped or lost):
          // still surface the gate rather than hiding that Mat asked.
          const toolName = asString(action.toolName) ?? "desconhecida";
          const card: Extract<TranscriptItem, { kind: "action" }> = {
            kind: "action",
            id: `${id}:${callId}`,
            at,
            callId,
            toolName,
            input: action.input,
            status: "pending",
            approvalRequested: true,
            truncated: event.truncated,
          };
          actionsByCallId.set(callId, card);
          items.push(card);
        }
        break;
      }

      case "action.result": {
        const result = asRecord(payload.result);
        const callId = asString(result.callId);
        if (!callId) break;

        const status = asString(payload.status);
        const card = actionsByCallId.get(callId);
        if (!card) break;

        card.status =
          status === "completed" || status === "failed" || status === "rejected"
            ? status
            : "pending";
        card.truncated ||= event.truncated;
        if ("output" in result) card.output = result.output;

        const error = asRecord(payload.error);
        const message = asString(error.message);
        if (message) {
          card.error = { code: asString(error.code) ?? undefined, message };
        }
        break;
      }

      case "turn.failed": {
        const message =
          asString(payload.message) ?? "A conversa falhou neste turno.";
        items.push({ kind: "turn-failed", id, at, message });
        break;
      }

      // turn.completed and any future Eve event: nothing to render.
      default:
        break;
    }
  }

  return items;
}

/** Counts what the conversation list shows: how much the two sides said. */
export function countMessages(events: readonly ConversationEventRow[]): number {
  return events.filter((event) => {
    const payload = asRecord(event.payload);
    const text = asString(payload.message);
    if (!text || text.trim().length === 0) return false;
    if (event.type === "message.received") return !isClientContext(text);
    return event.type === "message.completed";
  }).length;
}
