/**
 * Adapter: a thrown error from a Meta call (`validate_only`, real create, or an
 * asset upload) → {@link CreateIssue}s for the creation primitives (ADR 0009).
 *
 * Handles BOTH error classes used in the codebase:
 * - {@link GraphApiError} (thrown by `metaApiCall`) — carries the `errorMap`
 *   mapping whose `reason.solution` is already an actionable hint.
 * - {@link MetaApiError} (thrown by `fetchMetaGraph`/`throwMetaError`, e.g. the
 *   image/video upload helpers) — carries `blame_field_specs`.
 *
 * Callers may layer a more specific v25.0 suggestion via `subcodeSuggestion`.
 * Kept separate from ./types so the pure contract + rules engine stay free of the
 * Meta/observability import chain.
 */

import { GraphApiError } from "@/lib/meta-business/error";
import { MetaApiError } from "../normalize-meta-error";
import type { CreateIssue, CreateLevel, CreateResult, CreateStage } from "./types";

const GENERIC_SUGGESTION =
  "Erro inesperado ao falar com a Meta. Tente novamente; se persistir, verifique a conexão e o token.";

export function issuesFromError(
  error: unknown,
  stage: Exclude<CreateStage, "local">,
  level: CreateLevel,
  subcodeSuggestion?: (code?: number, subcode?: number) => string | undefined,
): CreateIssue[] {
  if (error instanceof GraphApiError) {
    const data = error.errorReturn.data;
    const reasonMap = error.errorReturn.reason;
    const code = data?.code;
    const subcode = data?.errorSubcode;
    const override = subcodeSuggestion?.(code, subcode);
    return [
      {
        stage,
        level,
        code: metaCode(code, subcode),
        reason: data?.errorUserMsg ?? data?.message ?? reasonMap.message,
        suggestion: override ?? reasonMap.solution,
        ...(code != null && { metaCode: code }),
        ...(subcode != null && { metaSubcode: subcode }),
        transient: reasonMap.isTransient,
      },
    ];
  }

  if (error instanceof MetaApiError) {
    const m = error.metaError;
    const code = m?.code;
    const subcode = m?.error_subcode;
    const override = subcodeSuggestion?.(code, subcode);
    const field = m?.blame_field_specs?.[0];
    return [
      {
        stage,
        level: error.level && isCreateLevel(error.level) ? error.level : level,
        code: metaCode(code, subcode),
        reason: m?.error_user_msg ?? error.message,
        suggestion:
          override ??
          "Revise os campos indicados do criativo/anúncio e tente novamente.",
        ...(field && { field }),
        ...(code != null && { metaCode: code }),
        ...(subcode != null && { metaSubcode: subcode }),
        transient: m?.is_transient,
      },
    ];
  }

  return [
    {
      stage,
      level,
      code: "UNEXPECTED",
      reason: error instanceof Error ? error.message : String(error),
      suggestion: GENERIC_SUGGESTION,
      transient: true,
    },
  ];
}

function metaCode(code?: number, subcode?: number): string {
  if (code == null) return "META_UNKNOWN";
  return `META_${code}${subcode != null ? `_${subcode}` : ""}`;
}

const CREATE_LEVELS = new Set(["campaign", "adset", "ad", "creative"]);
function isCreateLevel(level: string): level is CreateLevel {
  return CREATE_LEVELS.has(level);
}

/**
 * Bridge for callers that expect the legacy throw-based flow (the wizards): return
 * the created id on success, or throw a {@link MetaApiError} built from the issues
 * so the existing rollback + route error-normalization keep working unchanged.
 */
export function resultOrThrow<T extends { id: string }>(
  result: CreateResult<T>,
  level: CreateLevel,
): string {
  if (result.ok) return result.id;
  const first = result.issues[0];
  const reason = result.issues.map((i) => i.reason).join(" | ");
  const suggestion = result.issues.map((i) => i.suggestion).join(" | ");
  const metaLevel = level === "creative" ? "adcreative" : level;
  throw new MetaApiError(
    reason || "Falha de criação",
    {
      error_user_title: "Não foi possível concluir a criação",
      error_user_msg: suggestion ? `${reason} — ${suggestion}` : reason,
      ...(first?.metaCode != null && { code: first.metaCode }),
      ...(first?.metaSubcode != null && { error_subcode: first.metaSubcode }),
      is_transient: first?.transient,
    },
    metaLevel,
  );
}
