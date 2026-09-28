/**
 * Dias e horários de um conjunto sob orçamento de campanha (CBO): a troca só é segura
 * quando a campanha NASCEU programada (`pacing_type=["day_parting"]` na campanha) e a
 * conta está liberada — aí a edição manda só a grade (lib/meta-business/schedule-shape.ts).
 * Nos demais casos, mandar `pacing_type`/`adset_schedule` para um conjunto publicado sob
 * CBO é aceito pela Meta com 200 e o conjunto nunca mais entra no leilão (17 de 17 casos
 * medidos, jul–set/2026). Quem precisa de outro horário duplica a campanha já com ele.
 */
import { SCHEDULE_REFUSALS } from "@/lib/meta-business/schedule-shape";
import { localIssue } from "../creation/types";
import type { CreateIssue } from "./types";

export const SCHEDULE_LOCKED_UNDER_CBO = "SCHEDULE_LOCKED_UNDER_CBO";

export const SCHEDULE_LOCK_REASON = SCHEDULE_REFUSALS.SCHEDULE_LOCKED_UNDER_CBO.message;

export const SCHEDULE_LOCK_SUGGESTION = SCHEDULE_REFUSALS.SCHEDULE_LOCKED_UNDER_CBO.solution;

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
