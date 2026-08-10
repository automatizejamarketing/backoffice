// ===== BEGIN meta_tracking internal writer — espelhado byte a byte no projeto irmão =====
/**
 * Costura 2 — o gravador do stream de ações INTERNAS (§7 do plano
 * `backoffice/docs/plans/campaign-tracking-foundation.md`, "Costura 2" da spec).
 *
 * Toda alteração feita pela plataforma — pelo backoffice em nome do cliente ou
 * pelo próprio cliente no painel — nasce aqui como um evento de
 * `meta_tracking_change_events`, com autoria e horário EXATOS. É o que separa
 * uma ação declarada de uma ação descoberta: o coletor diário só sabe que algo
 * mudou entre ontem e hoje; quem escreve sabe quem, quando e por quê.
 *
 * Puro por decisão: nada aqui importa banco nem faz fetch. As rotas montam a
 * entrada, chamam, e passam o rascunho para um executor fino de INSERT. É o que
 * permite testar o contrato inteiro — motivo obrigatório, formato do diff,
 * ponte com o log legado, aplicado vs falhou — sem banco e sem Meta.
 *
 * ## Onde este módulo vive na arquitetura
 *
 * Na CAMADA DE WRAPPER das rotas, o mesmo lugar onde os logs de auditoria
 * legados são gravados hoje. Os primitives de atualização
 * (`lib/meta-business/marketing/update/`) continuam sendo a superfície única de
 * edição e permanecem INTOCADOS — são fonte espelhada byte a byte entre os dois
 * projetos (ADR 0010). Este arquivo é espelhado pelo mesmo motivo: os dois
 * projetos escrevem no MESMO stream, e um formato de diff diferente de cada
 * lado tornaria o stream ilegível. `automatize-frontend/tests/
 * meta-tracking-writer-parity.test.ts` compara os dois byte a byte.
 *
 * ## O vocabulário do diff é o da Graph API
 *
 * `changed_fields` usa as chaves de PRIMEIRO nível da resposta da Meta
 * (`daily_budget`, `targeting`, `name`, `status`…), exatamente como o diff do
 * coletor. Não é preciosismo: é o que faz a deduplicação do dia seguinte
 * funcionar — o coletor compara o delta que ele calculou com o que já está no
 * stream, e só reconhece "é a mesma mudança" se os dois falarem a mesma língua.
 * Dinheiro segue a Meta: unidades MENORES (centavos), como string.
 *
 * ## Motivo obrigatório é regra de aplicação, não do banco
 *
 * A coluna `note` é nullable de propósito: o mesmo evento vindo do coletor
 * legitimamente não tem motivo, porque ninguém o declarou. A obrigação vive
 * onde existe alguém para responder por ela — a origem `backoffice_admin`. E é
 * validada ANTES de qualquer chamada à Meta (`validateChangeNote`), para que
 * uma mutação sem motivo não chegue a mexer na conta do cliente.
 */

import type {
  MetaTrackingChangedFields,
  MetaTrackingChangeKind,
  MetaTrackingChangeSource,
  MetaTrackingEntityLevel,
} from "@/lib/db/schema";

/**
 * As duas origens que uma escrita interna pode ter. `external_detected` é do
 * coletor e `system` é da plataforma agindo sozinha — nenhuma das duas passa
 * por aqui.
 */
export type InternalChangeSource = Extract<
  MetaTrackingChangeSource,
  "backoffice_admin" | "frontend_user"
>;

/**
 * Chave RESERVADA de `changed_fields` que registra que a plataforma TENTOU
 * aplicar a mudança e a Meta recusou — o mesmo que os logs legados guardam em
 * `applied_to_meta` + `error_message`.
 *
 * Mora dentro de `changed_fields` porque a tabela não tem coluna para isso e
 * esta fundação não abre migration nova (a consolidada é ticket futuro; ver os
 * Comments do ticket 07). O prefixo `__` não existe no vocabulário da Graph
 * API, então a chave não colide com campo real nenhum e
 * `changed_fields ? 'daily_budget'` continua honesto.
 *
 * **Presença = falhou. Ausência = aplicado.** Só o caso excepcional é marcado,
 * para não poluir o caminho feliz nem o diff de quem lê o stream.
 */
export const APPLY_FAILED_FIELD = "__apply_failed__";

/** Um campo que a mutação tentou mudar, no vocabulário da Graph API. */
export type FieldChange = {
  field: string;
  old: unknown;
  new: unknown;
};

/** Motivo ausente numa origem que exige motivo. */
export type ChangeNoteIssue = {
  code: "missing_change_note";
  reason: string;
  suggestion: string;
};

export type ChangeNoteResult =
  | { ok: true; note: string | null }
  | { ok: false; issue: ChangeNoteIssue };

export type InternalChangeInput = {
  source: InternalChangeSource;
  /** Dono da conta de anúncio — o cliente, mesmo quando quem age é o gestor. */
  userId: string;
  /** Sempre no formato `act_<id>`. */
  accountId: string;
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  entityName?: string | null;
  campaignId?: string | null;
  adsetId?: string | null;
  changeKind: MetaTrackingChangeKind;
  changes: readonly FieldChange[];
  /** Gestor no backoffice ou o próprio cliente no painel. */
  actorEmail?: string | null;
  /** Motivo. Obrigatório quando a origem é o backoffice. */
  note?: string | null;
  /** Horário EXATO da ação — a vantagem que o coletor nunca terá. */
  occurredAt: Date;
  appliedToMeta: boolean;
  errorMessage?: string | null;
  /** Ponte com o log legado gravado no mesmo dual-write. */
  legacy?: { table: string; id: string } | null;
};

/** Uma linha de `meta_tracking_change_events` pronta para insert. */
export type InternalChangeEventDraft = {
  userId: string;
  accountId: string;
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  entityName: string | null;
  campaignId: string | null;
  adsetId: string | null;
  changeKind: MetaTrackingChangeKind;
  changedFields: MetaTrackingChangedFields;
  source: InternalChangeSource;
  actorEmail: string | null;
  note: string | null;
  occurredAt: Date;
  detectedAt: Date;
  legacyEditLogTable: string | null;
  legacyEditLogId: string | null;
};

/**
 * `event: null` significa "nada a gravar": a mutação foi aceita mas nenhum
 * campo mudou de fato. Um evento vazio no stream seria ruído com aparência de
 * ação.
 */
export type InternalChangeEventResult =
  | { ok: true; event: InternalChangeEventDraft | null }
  | { ok: false; issue: ChangeNoteIssue };

/**
 * O portão do motivo, isolado para as rotas o chamarem ANTES de tocar na Meta:
 * mutação sem motivo não pode chegar a mexer na conta do cliente e só depois
 * ser rejeitada.
 */
export function validateChangeNote(
  source: InternalChangeSource,
  note: string | null | undefined,
): ChangeNoteResult {
  const trimmed = typeof note === "string" ? note.trim() : "";

  if (source === "backoffice_admin" && trimmed.length === 0) {
    return {
      ok: false,
      issue: {
        code: "missing_change_note",
        reason:
          "Toda alteração feita pelo backoffice precisa de um motivo registrado.",
        suggestion:
          "Descreva por que esta alteração está sendo feita antes de salvar.",
      },
    };
  }

  return { ok: true, note: trimmed.length > 0 ? trimmed : null };
}

/**
 * Dois valores de campo da Meta dizem a mesma coisa?
 *
 * As rotas leem o valor anterior da Meta (dinheiro como string, data com
 * offset) e calculam o novo em outro formato (número, ISO em UTC) — comparar
 * cru marcaria como mudança o que é só diferença de representação, e o stream
 * registraria ações que ninguém tomou.
 *
 * A mesma pergunta é feita do outro lado, na deduplicação da coleta ("o que o
 * coletor viu é o que a rota registrou?"). É a mesma função de propósito: se as
 * duas respostas divergissem, uma ação apareceria duas vezes no stream.
 */
export function sameMetaFieldValue(a: unknown, b: unknown): boolean {
  return canonicalValue(a) === canonicalValue(b);
}

function canonicalValue(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    // Só o que TEM cara de data ISO é comparado como instante. `Date.parse`
    // aceita "5000" como o ano 5000, e orçamento em centavos é exatamente isso
    // — a checagem de formato é o que impede dinheiro de virar data.
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(value)) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return `@${parsed}`;
    }
    return value;
  }
  if (value instanceof Date) return `@${value.getTime()}`;
  return JSON.stringify(canonicalize(value));
}

/** Ordena chaves de objeto recursivamente; ordem de array é preservada. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value ?? null;
  const source = value as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    ordered[key] = canonicalize(source[key]);
  }
  return ordered;
}

/** `undefined` não existe em jsonb, e "ausente" e "nulo" dizem o mesmo aqui. */
function jsonSafe(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * O diff campo a campo, no formato que a busca por campo alterado
 * (`changed_fields ? 'daily_budget'`) interroga. Campo que não mudou de fato
 * some — o que sobra é exatamente o que a ação fez.
 */
export function buildChangedFields(
  changes: readonly FieldChange[],
): MetaTrackingChangedFields {
  const changed: MetaTrackingChangedFields = {};
  for (const change of changes) {
    if (sameMetaFieldValue(change.old, change.new)) continue;
    changed[change.field] = {
      old: jsonSafe(change.old),
      new: jsonSafe(change.new),
    };
  }
  return changed;
}

/**
 * Orçamento CONFIGURADO igual a zero não existe: é a Meta dizendo "o dinheiro
 * está no outro nível". Tratá-lo como valor faria uma migração CBO↔ABO
 * registrar `daily_budget: "0" → null`, uma mudança que ninguém fez — e o
 * normalizador da coleta, que anula o zero, nunca reconheceria a ação como
 * já registrada.
 */
function configuredMoney(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return Number(value) > 0 ? value : null;
}

/**
 * O que uma mutação de orçamento de CAMPANHA mudou, no vocabulário da Meta.
 *
 * O orçamento vive no nível em que a Meta o guarda: em CBO na campanha, em ABO
 * nos conjuntos. Migrar de um para o outro é, para a campanha, ganhar ou perder
 * o valor — e é assim que a coleta do dia seguinte vai enxergar.
 */
export function campaignBudgetFieldChanges(input: {
  mode: "CBO" | "ABO";
  previousDailyBudget: string | null;
  previousLifetimeBudget: string | null;
  /** O que a rota mandou para a Meta; ausente = não mexeu neste campo. */
  nextDailyBudget?: string | null;
  nextLifetimeBudget?: string | null;
}): FieldChange[] {
  const previousDaily = configuredMoney(input.previousDailyBudget);
  const previousLifetime = configuredMoney(input.previousLifetimeBudget);

  if (input.mode === "ABO") {
    // O dinheiro saiu da campanha e foi para os conjuntos.
    return [
      { field: "daily_budget", old: previousDaily, new: null },
      { field: "lifetime_budget", old: previousLifetime, new: null },
    ];
  }

  return [
    {
      field: "daily_budget",
      old: previousDaily,
      new: configuredMoney(input.nextDailyBudget) ?? previousDaily,
    },
    {
      field: "lifetime_budget",
      old: previousLifetime,
      new: configuredMoney(input.nextLifetimeBudget) ?? previousLifetime,
    },
  ];
}

/**
 * O que a mesma mutação mudou em UM conjunto. Só o campo que a rota realmente
 * escreveu entra: dizer que o outro foi a zero seria inventar uma mudança.
 */
export function adsetBudgetFieldChanges(input: {
  previousDailyBudget?: string | null;
  newDailyBudget?: string | null;
  previousLifetimeBudget?: string | null;
  newLifetimeBudget?: string | null;
}): FieldChange[] {
  const changes: FieldChange[] = [];

  if (configuredMoney(input.newDailyBudget)) {
    changes.push({
      field: "daily_budget",
      old: configuredMoney(input.previousDailyBudget),
      new: input.newDailyBudget,
    });
  }
  if (configuredMoney(input.newLifetimeBudget)) {
    changes.push({
      field: "lifetime_budget",
      old: configuredMoney(input.previousLifetimeBudget),
      new: input.newLifetimeBudget,
    });
  }

  return changes;
}

/** Lê a marca de falha do diff. Ausência = a Meta aceitou a mudança. */
export function isAppliedToMeta(
  changedFields: MetaTrackingChangedFields,
): boolean {
  return changedFields[APPLY_FAILED_FIELD] === undefined;
}

/**
 * Uma criação é notícia mesmo sem diff — a entidade não existia. Já uma
 * configuração ou um ciclo de vida sem nenhum campo alterado não aconteceu.
 */
function isWorthRecording(
  changeKind: MetaTrackingChangeKind,
  changedFields: MetaTrackingChangedFields,
): boolean {
  return changeKind === "created" || Object.keys(changedFields).length > 0;
}

export function buildInternalChangeEvent(
  input: InternalChangeInput,
): InternalChangeEventResult {
  const note = validateChangeNote(input.source, input.note);
  if (!note.ok) return note;

  const changedFields = buildChangedFields(input.changes);
  if (!isWorthRecording(input.changeKind, changedFields)) {
    return { ok: true, event: null };
  }

  if (!input.appliedToMeta) {
    changedFields[APPLY_FAILED_FIELD] = {
      old: null,
      new:
        input.errorMessage?.trim() ||
        "A Meta recusou a alteração; ela foi registrada mas não aplicada.",
    };
  }

  return {
    ok: true,
    event: {
      userId: input.userId,
      accountId: input.accountId,
      entityLevel: input.entityLevel,
      entityId: input.entityId,
      entityName: input.entityName ?? null,
      campaignId: input.campaignId ?? null,
      adsetId: input.adsetId ?? null,
      changeKind: input.changeKind,
      changedFields,
      source: input.source,
      actorEmail: input.actorEmail ?? null,
      note: note.note,
      // Escrita interna é o único caso em que os dois carimbos coincidem: quem
      // detectou a ação foi quem a executou, no mesmo instante.
      occurredAt: input.occurredAt,
      detectedAt: input.occurredAt,
      legacyEditLogTable: input.legacy?.table ?? null,
      legacyEditLogId: input.legacy?.id ?? null,
    },
  };
}
// ===== END meta_tracking internal writer =====
