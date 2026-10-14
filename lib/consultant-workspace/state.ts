import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, like, notInArray, or, sql } from "drizzle-orm";
import {
  canAccessMarketingUser,
  hasBackofficePermission,
  type BackofficeActor,
} from "@/lib/auth/rbac-core";
import { db } from "@/lib/db";
import { setMarketingConsultantAssignment } from "@/lib/db/backoffice-rbac-queries";
import {
  consultantClientAiAnalysis,
  consultantClientGoal,
  consultantClientNote,
  consultantClientProblemTag,
  consultantOnboardingHandoff,
  performanceInsight,
} from "@/lib/db/schema";
import { ACCOUNT_ALERTS_RULE_PREFIX } from "@/lib/account-alerts/constants";
import { PLAYBOOK_INSIGHTS_RULE_PREFIX } from "@/lib/playbook-insights/constants";
import { PROBLEM_TAG_BY_KEY } from "./journey";
import { isMatTemplateKey } from "./outreach-core";
import type {
  AlertOutcome,
  GoalKpi,
  NoteKind,
  WorkspaceAlertAction,
  WorkspaceOp,
  WorkspaceState,
} from "./types";

/**
 * Estado do consultor por cliente, no banco: metas, linha do tempo, passagem
 * de bastão, tags de problema, análise de IA e o tratamento dos alertas
 * (direto em `performance_insights`, como a tela de Alertas).
 *
 * O formato devolvido é o mesmo que as telas da área de Tráfego consomem;
 * toda escrita passa por `applyWorkspaceOp`, que confere permissão e carteira.
 */

/** Quanto da linha do tempo trazer: o suficiente para o histórico recente da carteira. */
const NOTES_LOOKBACK_DAYS = 180;
const ALERT_ACTIONS_LOOKBACK_DAYS = 14;

const toIso = (value: Date | string | null | undefined) =>
  value == null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const consultantAlertScope = or(
  like(performanceInsight.ruleId, `${PLAYBOOK_INSIGHTS_RULE_PREFIX}%`),
  like(performanceInsight.ruleId, `${ACCOUNT_ALERTS_RULE_PREFIX}%`),
);

/**
 * Sinais que a Fila calcula dos dados (`sinal:<tipo>:<userId>`: Meta
 * desconectada, parou de entregar, fora da meta…) não existem em
 * `performance_insights`. Concluir ou adiar um deles grava uma linha
 * `kind = "sinal"` (fora da linha do tempo), lida de volta em `alertActions`.
 */
const SIGNAL_NOTE_KIND = "sinal";
const SIGNAL_KEY = /^sinal:[a-z_]+:([0-9a-f-]{36})$/i;

function splitAlertIds(ids: string[]) {
  const insightIds: string[] = [];
  const signals: Array<{ key: string; userId: string }> = [];
  for (const id of ids) {
    const match = SIGNAL_KEY.exec(id);
    if (match) signals.push({ key: id, userId: match[1] });
    else insightIds.push(id);
  }
  return { insightIds, signals };
}

type SignalNoteMetadata = {
  signalKey?: string;
  status?: WorkspaceAlertAction["status"] | "cleared";
  outcome?: AlertOutcome | null;
  snoozeUntil?: string | null;
};

export async function readWorkspaceState(options: { userIds?: string[] } = {}): Promise<WorkspaceState> {
  const userFilter = <T extends { userId: unknown }>(column: T["userId"]) =>
    options.userIds ? inArray(column as never, options.userIds) : undefined;
  if (options.userIds && options.userIds.length === 0) {
    return emptyWorkspaceState();
  }
  const since = new Date(Date.now() - NOTES_LOOKBACK_DAYS * 86_400_000);
  const alertsSince = new Date(Date.now() - ALERT_ACTIONS_LOOKBACK_DAYS * 86_400_000);

  const [goals, notes, handoffs, tags, analyses, handledAlerts] = await Promise.all([
    db.select().from(consultantClientGoal).where(userFilter(consultantClientGoal.userId)),
    db
      .select()
      .from(consultantClientNote)
      .where(and(gt(consultantClientNote.createdAt, since), userFilter(consultantClientNote.userId)))
      .orderBy(desc(consultantClientNote.createdAt))
      .limit(5000),
    db.select().from(consultantOnboardingHandoff).where(userFilter(consultantOnboardingHandoff.userId)),
    db.select().from(consultantClientProblemTag).where(userFilter(consultantClientProblemTag.userId)),
    db.select().from(consultantClientAiAnalysis).where(userFilter(consultantClientAiAnalysis.userId)),
    db
      .select({
        id: performanceInsight.id,
        status: performanceInsight.status,
        reviewOutcome: performanceInsight.reviewOutcome,
        reviewNote: performanceInsight.reviewNote,
        reviewedByEmail: performanceInsight.reviewedByEmail,
        reviewedAt: performanceInsight.reviewedAt,
        snoozedUntil: performanceInsight.snoozedUntil,
        updatedAt: performanceInsight.updatedAt,
      })
      .from(performanceInsight)
      .where(
        and(
          consultantAlertScope,
          userFilter(performanceInsight.userId),
          or(
            gt(performanceInsight.snoozedUntil, new Date()),
            and(isNotNull(performanceInsight.reviewedByEmail), gt(performanceInsight.reviewedAt, alertsSince)),
          ),
        ),
      ),
  ]);

  const state = emptyWorkspaceState();
  const seenSignals = new Set<string>();
  for (const goal of goals) {
    state.goals[goal.userId] = {
      kpi: goal.kpi as GoalKpi,
      target: Number(goal.target),
      monthlyBudget: goal.monthlyBudget == null ? null : Number(goal.monthlyBudget),
      updatedAt: toIso(goal.updatedAt) ?? undefined,
      updatedBy: goal.updatedByEmail,
    };
  }
  for (const note of notes) {
    if (note.kind === SIGNAL_NOTE_KIND) {
      // Mais recente primeiro: a primeira linha de cada sinal é o estado atual ("cleared" = voltou à fila).
      const meta = (note.metadata ?? {}) as SignalNoteMetadata;
      if (!meta.signalKey || seenSignals.has(meta.signalKey)) continue;
      seenSignals.add(meta.signalKey);
      if (meta.status === "done" || meta.status === "dismissed" || meta.status === "snoozed") {
        state.alertActions[meta.signalKey] = {
          status: meta.status,
          outcome: meta.outcome ?? null,
          note: null,
          snoozeUntil: meta.snoozeUntil ?? null,
          by: note.authorEmail,
          at: toIso(note.createdAt)!,
        };
      }
      continue;
    }
    if (note.kind === "mensagem") {
      const templateKey = String((note.metadata as { templateKey?: string } | null)?.templateKey ?? "");
      state.sentMessages.push({
        id: note.id,
        userId: note.userId,
        templateKey,
        text: note.body,
        by: note.authorEmail,
        at: toIso(note.createdAt)!,
        channel: isMatTemplateKey(templateKey) ? "mat" : "manual",
      });
      continue;
    }
    state.notes.push({
      id: note.id,
      userId: note.userId,
      kind: note.kind as NoteKind,
      text: note.body,
      author: note.authorEmail,
      createdAt: toIso(note.createdAt)!,
    });
  }
  for (const handoff of handoffs) {
    state.handoffs[handoff.userId] = {
      summary: handoff.summary,
      nextSteps: handoff.nextSteps,
      callDate: handoff.callDate ?? null,
      by: handoff.authorEmail,
      at: toIso(handoff.updatedAt)!,
    };
  }
  for (const tag of tags) {
    const bucket = tag.state === "dismissed" ? state.dismissedAutoTags : state.clientTags;
    (bucket[tag.userId] ??= []).push(tag.tagKey);
  }
  for (const analysis of analyses) {
    state.aiAnalyses[analysis.userId] = {
      text: analysis.body,
      model: analysis.model,
      periodDays: analysis.periodDays,
      generatedAt: toIso(analysis.generatedAt)!,
      by: analysis.generatedByEmail,
    };
  }
  const now = Date.now();
  for (const alert of handledAlerts) {
    const snoozed = alert.snoozedUntil && alert.snoozedUntil.getTime() > now && (alert.status === "open" || alert.status === "acknowledged");
    const action: WorkspaceAlertAction = snoozed
      ? {
          status: "snoozed",
          outcome: null,
          note: alert.reviewNote,
          snoozeUntil: toIso(alert.snoozedUntil),
          by: alert.reviewedByEmail ?? "",
          at: toIso(alert.updatedAt)!,
        }
      : {
          status: alert.status === "dismissed" ? "dismissed" : "done",
          outcome: (alert.reviewOutcome as AlertOutcome | null) ?? null,
          note: alert.reviewNote,
          snoozeUntil: null,
          by: alert.reviewedByEmail ?? "",
          at: toIso(alert.reviewedAt ?? alert.updatedAt)!,
        };
    if (!snoozed && alert.status !== "done" && alert.status !== "dismissed") continue;
    state.alertActions[alert.id] = action;
  }
  return state;
}

export function emptyWorkspaceState(): WorkspaceState {
  return {
    goals: {},
    notes: [],
    alertActions: {},
    simulatedActions: [],
    assignments: {},
    handoffs: {},
    clientTags: {},
    dismissedAutoTags: {},
    sentMessages: [],
    aiAnalyses: {},
  };
}

export class WorkspaceOpError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 = 400,
  ) {
    super(message);
  }
}

function assertWrite(actor: BackofficeActor, userId: string) {
  if (!hasBackofficePermission(actor, "marketing:write")) {
    throw new WorkspaceOpError("Seu cargo não pode alterar clientes.", 403);
  }
  if (!canAccessMarketingUser(actor, userId)) {
    throw new WorkspaceOpError("Este cliente não está na sua carteira.", 403);
  }
}

function assertKnownTags(tags: string[]) {
  const unknown = tags.filter((tag) => !PROBLEM_TAG_BY_KEY.has(tag));
  if (unknown.length > 0) throw new WorkspaceOpError(`Tags desconhecidas: ${unknown.join(", ")}`);
}

const NOTE_KINDS: NoteKind[] = ["nota", "contato", "reuniao", "acao"];

/**
 * Aplica uma operação da área de Tráfego. `source` diz de onde veio (tela ou
 * MCP) e fica na linha do tempo.
 */
export async function applyWorkspaceOp(
  actor: BackofficeActor,
  op: WorkspaceOp,
  source: "backoffice" | "mcp" = "backoffice",
): Promise<void> {
  const now = new Date();
  switch (op.op) {
    case "setGoal": {
      assertWrite(actor, op.userId);
      if (!(op.goal.target > 0)) throw new WorkspaceOpError("Alvo inválido.");
      const values = {
        kpi: op.goal.kpi,
        target: String(op.goal.target),
        monthlyBudget: op.goal.monthlyBudget && op.goal.monthlyBudget > 0 ? String(op.goal.monthlyBudget) : null,
        updatedByEmail: actor.email,
        updatedAt: now,
      };
      await db
        .insert(consultantClientGoal)
        .values({ userId: op.userId, ...values })
        .onConflictDoUpdate({ target: consultantClientGoal.userId, set: values });
      return;
    }
    case "clearGoal":
      assertWrite(actor, op.userId);
      await db.delete(consultantClientGoal).where(eq(consultantClientGoal.userId, op.userId));
      return;
    case "addNote": {
      assertWrite(actor, op.userId);
      const text = op.text.trim();
      if (!text) throw new WorkspaceOpError("Nota vazia.");
      if (!NOTE_KINDS.includes(op.kind)) throw new WorkspaceOpError("Tipo de nota inválido.");
      await db.insert(consultantClientNote).values({ userId: op.userId, kind: op.kind, body: text.slice(0, 4000), authorEmail: actor.email, source });
      return;
    }
    case "deleteNote": {
      // Só quem escreveu apaga a própria nota.
      const [note] = await db.select().from(consultantClientNote).where(eq(consultantClientNote.id, op.noteId)).limit(1);
      if (!note) return;
      assertWrite(actor, note.userId);
      if (note.authorEmail !== actor.email) throw new WorkspaceOpError("Só quem escreveu pode apagar a nota.", 403);
      await db.delete(consultantClientNote).where(eq(consultantClientNote.id, op.noteId));
      return;
    }
    case "alertAction": {
      const userId = op.userId;
      if (!userId) throw new WorkspaceOpError("Cliente obrigatório.");
      assertWrite(actor, userId);
      if (op.insightIds.length === 0) return;
      if (op.status === "snoozed" && !op.snoozeUntil) throw new WorkspaceOpError("Informe até quando adiar.");
      const { insightIds, signals } = splitAlertIds(op.insightIds);
      if (signals.some((signal) => signal.userId !== userId)) throw new WorkspaceOpError("Sinal de outro cliente.");
      if (insightIds.length > 0) {
        const scope = and(
          eq(performanceInsight.userId, userId),
          inArray(performanceInsight.id, insightIds),
          inArray(performanceInsight.status, ["open", "acknowledged"]),
          consultantAlertScope,
        );
        if (op.status === "snoozed") {
          await db
            .update(performanceInsight)
            .set({
              snoozedUntil: new Date(op.snoozeUntil!),
              reviewedByEmail: actor.email,
              reviewNote: op.note?.trim() || null,
              updatedAt: now,
            })
            .where(scope);
        } else {
          // Mesmo UPDATE atômico da tela de Alertas: nunca sobrescreve o que outro consultor já finalizou.
          await db
            .update(performanceInsight)
            .set({
              status: op.status === "dismissed" ? "dismissed" : "done",
              reviewOutcome: op.outcome ?? null,
              reviewedByEmail: actor.email,
              reviewNote: op.note?.trim() || null,
              reviewedAt: now,
              snoozedUntil: null,
              updatedAt: now,
            })
            .where(scope);
        }
      }
      if (signals.length > 0) {
        await db.insert(consultantClientNote).values(
          signals.map((signal) => ({
            userId,
            kind: SIGNAL_NOTE_KIND,
            body: op.status === "snoozed" ? "Sinal adiado" : op.status === "dismissed" ? "Sinal descartado" : "Sinal concluído",
            metadata: {
              signalKey: signal.key,
              status: op.status,
              outcome: op.status === "snoozed" ? null : (op.outcome ?? null),
              snoozeUntil: op.status === "snoozed" ? op.snoozeUntil : null,
            } satisfies SignalNoteMetadata,
            authorEmail: actor.email,
            source,
          })),
        );
      }
      if (op.note?.trim() && op.status !== "snoozed") {
        await db.insert(consultantClientNote).values({ userId, kind: "acao", body: op.note.trim().slice(0, 4000), authorEmail: actor.email, source });
      }
      return;
    }
    case "clearAlertAction": {
      // Desfaz só o adiamento ("Trazer agora"); concluído não volta para a fila.
      if (op.insightIds.length === 0) return;
      const { insightIds, signals } = splitAlertIds(op.insightIds);
      for (const userId of new Set(signals.map((signal) => signal.userId))) assertWrite(actor, userId);
      if (insightIds.length > 0) {
        const rows = await db
          .select({ userId: performanceInsight.userId })
          .from(performanceInsight)
          .where(inArray(performanceInsight.id, insightIds));
        for (const userId of new Set(rows.map((row) => row.userId))) assertWrite(actor, userId);
        await db
          .update(performanceInsight)
          .set({ snoozedUntil: null, updatedAt: now })
          .where(and(inArray(performanceInsight.id, insightIds), inArray(performanceInsight.status, ["open", "acknowledged"])));
      }
      if (signals.length > 0) {
        await db.insert(consultantClientNote).values(
          signals.map((signal) => ({
            userId: signal.userId,
            kind: SIGNAL_NOTE_KIND,
            body: "Sinal de volta à fila",
            metadata: { signalKey: signal.key, status: "cleared" } satisfies SignalNoteMetadata,
            authorEmail: actor.email,
            source,
          })),
        );
      }
      return;
    }
    case "assign": {
      if (!hasBackofficePermission(actor, "users:manage")) {
        throw new WorkspaceOpError("Seu cargo não pode trocar o responsável.", 403);
      }
      // `consultant` aqui é o id do consultor no backoffice (ou null para remover).
      await setMarketingConsultantAssignment({
        userId: op.userId,
        consultantId: op.consultant,
        assignedByEmail: actor.email,
      });
      return;
    }
    case "setHandoff": {
      assertWrite(actor, op.userId);
      assertKnownTags(op.tags);
      const summary = op.summary.trim();
      if (!summary) throw new WorkspaceOpError("Resumo obrigatório.");
      const values = {
        summary: summary.slice(0, 4000),
        nextSteps: op.nextSteps.trim().slice(0, 4000),
        callDate: op.callDate || null,
        authorEmail: actor.email,
        updatedAt: now,
      };
      await db
        .insert(consultantOnboardingHandoff)
        .values({ userId: op.userId, ...values })
        .onConflictDoUpdate({ target: consultantOnboardingHandoff.userId, set: values });
      await replaceManualTags(actor, op.userId, op.tags);
      await db.insert(consultantClientNote).values({
        userId: op.userId,
        kind: "nota",
        body: `Passagem de bastão do onboarding: ${values.summary}${values.nextSteps ? ` — Próximos passos: ${values.nextSteps}` : ""}`,
        authorEmail: actor.email,
        source,
      });
      return;
    }
    case "setClientTags":
      assertWrite(actor, op.userId);
      assertKnownTags(op.tags);
      await replaceManualTags(actor, op.userId, op.tags);
      return;
    case "dismissAutoTag": {
      assertWrite(actor, op.userId);
      assertKnownTags([op.tag]);
      if (op.dismissed) {
        await db
          .insert(consultantClientProblemTag)
          .values({ userId: op.userId, tagKey: op.tag, state: "dismissed", updatedByEmail: actor.email })
          .onConflictDoUpdate({
            target: [consultantClientProblemTag.userId, consultantClientProblemTag.tagKey],
            set: { state: "dismissed", updatedByEmail: actor.email, updatedAt: now },
          });
      } else {
        await db
          .delete(consultantClientProblemTag)
          .where(and(eq(consultantClientProblemTag.userId, op.userId), eq(consultantClientProblemTag.tagKey, op.tag), eq(consultantClientProblemTag.state, "dismissed")));
      }
      return;
    }
    case "sendMessage":
      assertWrite(actor, op.userId);
      await db.insert(consultantClientNote).values({
        userId: op.userId,
        kind: "mensagem",
        body: op.text.trim().slice(0, 4000),
        metadata: { templateKey: op.templateKey },
        authorEmail: actor.email,
        source,
      });
      return;
    case "saveAiAnalysis": {
      assertWrite(actor, op.userId);
      const values = {
        body: op.analysis.text,
        model: op.analysis.model,
        periodDays: op.analysis.periodDays,
        generatedByEmail: actor.email,
        generatedAt: now,
      };
      await db
        .insert(consultantClientAiAnalysis)
        .values({ userId: op.userId, ...values })
        .onConflictDoUpdate({ target: consultantClientAiAnalysis.userId, set: values });
      return;
    }
    case "simulateMetaAction":
      throw new WorkspaceOpError("Ações na Meta usam as rotas de campanha, conjunto e anúncio.");
    case "reset":
      throw new WorkspaceOpError("Operação indisponível.");
  }
}

async function replaceManualTags(actor: BackofficeActor, userId: string, tags: string[]) {
  const unique = [...new Set(tags)];
  await db
    .delete(consultantClientProblemTag)
    .where(
      and(
        eq(consultantClientProblemTag.userId, userId),
        eq(consultantClientProblemTag.state, "active"),
        unique.length ? notInArray(consultantClientProblemTag.tagKey, unique) : sql`true`,
      ),
    );
  for (const tagKey of unique) {
    await db
      .insert(consultantClientProblemTag)
      .values({ userId, tagKey, state: "active", updatedByEmail: actor.email })
      .onConflictDoUpdate({
        target: [consultantClientProblemTag.userId, consultantClientProblemTag.tagKey],
        set: { state: "active", updatedByEmail: actor.email, updatedAt: new Date() },
      });
  }
}
