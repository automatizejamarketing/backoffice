/**
 * Dias e horários de um conjunto sob orçamento de campanha (CBO) só se definem na
 * CRIAÇÃO. Mandar `pacing_type`/`adset_schedule` para um conjunto já publicado sob CBO
 * é aceito pela Meta com 200 e a leitura não acusa nada, mas o conjunto nunca mais entra
 * no leilão — 13 de 13 casos avaliáveis em produção (jul–set/2026). A documentação manda
 * o `pacing_type` para a campanha sob Advantage campaign budget e não documenta a edição
 * de horário de CBO publicado (docs/research/2026-09-28-meta-cbo-horario-conjunto.md).
 * Quem precisa de outro horário duplica a campanha já com ele.
 */
import { localIssue } from "../creation/types";
import type { CreateIssue } from "./types";

export const SCHEDULE_LOCKED_UNDER_CBO = "SCHEDULE_LOCKED_UNDER_CBO";

export const SCHEDULE_LOCK_REASON =
  "Os dias e horários deste conjunto não podem ser alterados porque a campanha usa orçamento de campanha. A Meta aceita a mudança, mas o conjunto para de veicular de vez.";

export const SCHEDULE_LOCK_SUGGESTION =
  "Duplique a campanha já com o novo horário (Duplicar com novo horário) e depois pause a original.";

const SCHEDULE_FIELDS = ["pacing_type", "adset_schedule"] as const;

/** Whether the update would write the ad set's delivery schedule (adding, changing or clearing it). */
export function touchesAdSetSchedule(input: {
  schedule?: unknown;
  extraFields?: Record<string, unknown>;
}): boolean {
  if (input.schedule !== undefined) return true;
  const extra = input.extraFields;
  if (!extra) return false;
  return SCHEDULE_FIELDS.some((key) =>
    Object.prototype.hasOwnProperty.call(extra, key),
  );
}

export function scheduleLockIssue(): CreateIssue {
  return localIssue(
    "adset",
    SCHEDULE_LOCKED_UNDER_CBO,
    SCHEDULE_LOCK_REASON,
    SCHEDULE_LOCK_SUGGESTION,
    ["adset_schedule"],
  );
}

/** HTTP 400 body the edit routes answer with when the lock applies. */
export function scheduleLockRouteBody(): {
  error: string;
  message: string;
  solution: string;
} {
  return {
    error: SCHEDULE_LOCKED_UNDER_CBO,
    message: SCHEDULE_LOCK_REASON,
    solution: SCHEDULE_LOCK_SUGGESTION,
  };
}
