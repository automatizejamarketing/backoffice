import type { SanitizedCustomerFileHistory } from "@/lib/customer-file/sanitize";
import { type CreateIssue, type CreateResult, fail, localIssue, ok } from "../creation/types";
import { createCustomAudience } from "./create";
import type { AudienceCommandStore } from "./command-store";
import { listCustomAudiences } from "./read";
import { assessLookalikeSource, buildLookalikeFormation, type LookalikeFormation } from "./lookalike";

type LookalikeCommonInput = {
  adAccountId: string;
  accessToken: string;
  originAudienceId: string;
  name: string;
  description?: string;
  country: string;
  percentage: number;
  importHistory?: ReadonlyMap<string, SanitizedCustomerFileHistory>;
};

type LookalikeConfirmInput = LookalikeCommonInput & {
  confirmationToken: string;
  commandId?: string;
  actorUserId?: string;
  commandStore?: AudienceCommandStore;
};

export type LookalikeAudienceReview = {
  ok: true;
  operation: "create";
  adAccountId: string;
  source: { id: string; name?: string; subtype?: string };
  formation: LookalikeFormation;
  confirmationToken: string;
  commandId: string;
  state: "ready_to_submit";
  notice: string;
};

export type LookalikeAudienceMutationData = { id: string; state: "submitted"; alreadyApplied?: boolean };
export type LookalikeAudienceMutationResult = CreateResult<LookalikeAudienceMutationData>;
export type LookalikeAudienceReviewResult = LookalikeAudienceReview | { ok: false; issues: CreateIssue[] };

type LookalikeCommand = {
  operation: "create";
  adAccountId: string;
  originAudienceId: string;
  name: string;
  description?: string;
  formation: LookalikeFormation;
  existingAudienceIds: string[];
};

const completedCommands = new Map<string, LookalikeAudienceMutationResult>();
const unresolvedCommands = new Set<string>();
const inFlightCommands = new Map<string, Promise<LookalikeAudienceMutationResult>>();

function issue(code: string, reason: string, suggestion: string): CreateIssue { return localIssue("audience", code, reason, suggestion); }
function uncertainIssue(): CreateIssue {
  return { stage: "create", level: "audience", code: "META_MUTATION_UNCERTAIN", reason: "A resposta da Meta não confirmou se o público semelhante foi criado.", suggestion: "Não repita a confirmação. Consulte a biblioteca e reconcilie o comando antes de tentar outra ação.", transient: true };
}
function expiredIssue(): CreateIssue { return localIssue("audience", "COMMAND_EXPIRED", "A revisão do público expirou e não pode mais autorizar uma criação.", "Revise a origem e a formação novamente antes de confirmar."); }
function normalizedDescription(description: string | undefined): string | undefined { const value = description?.trim(); return value || undefined; }
function sourceSnapshot(source: { id: string; name?: string; subtype?: string; customerFileSource?: string; importState?: string; importResult?: unknown }) {
  return { id: source.id, name: source.name ?? null, subtype: source.subtype ?? null, customerFileSource: source.customerFileSource ?? null, importState: source.importState ?? null, importResult: source.importResult ?? null };
}
type RawCreateResult = Awaited<ReturnType<typeof createCustomAudience>>;
function resultIsUncertain(result: RawCreateResult): boolean { return (result.ok && !result.id) || (!result.ok && result.issues.some((candidate) => candidate.transient || candidate.code === "META_MUTATION_UNCERTAIN" || candidate.code === "META_CREATE_MISSING_ID")); }
function parseCommand(commandId: string): LookalikeCommand | null {
  try {
    const parsed = JSON.parse(commandId) as Partial<LookalikeCommand>;
    if (parsed.operation !== "create" || typeof parsed.adAccountId !== "string" || typeof parsed.originAudienceId !== "string" || typeof parsed.name !== "string" || !parsed.formation || typeof parsed.formation !== "object" || !Array.isArray(parsed.existingAudienceIds) || parsed.existingAudienceIds.some((id) => typeof id !== "string")) return null;
    const formation = parsed.formation as Partial<LookalikeFormation>;
    if (typeof formation.country !== "string" || typeof formation.percentage !== "number" || typeof formation.ratio !== "number") return null;
    return { operation: "create", adAccountId: parsed.adAccountId, originAudienceId: parsed.originAudienceId, name: parsed.name, ...(typeof parsed.description === "string" ? { description: parsed.description } : {}), formation: { country: formation.country, percentage: formation.percentage, ratio: formation.ratio }, existingAudienceIds: parsed.existingAudienceIds };
  } catch { return null; }
}

async function readReviewSource(input: LookalikeCommonInput) {
  const formation = buildLookalikeFormation({ country: input.country, percentage: input.percentage });
  if (!formation.ok) return { ok: false as const, issues: [issue("INVALID_FORMATION", formation.message, "Escolha um país ISO-2 e um percentual inteiro entre 1% e 20%.")] };
  const listed = await listCustomAudiences({ adAccountId: input.adAccountId, accessToken: input.accessToken, detailed: true, importHistory: input.importHistory });
  if (listed.truncated) return { ok: false as const, issues: [issue("LOOKALIKE_CREATE_BASELINE_INCOMPLETE", "Não foi possível obter a biblioteca completa antes da criação para garantir a reconciliação do comando.", "Conclua a consulta da biblioteca e tente novamente.")] };
  const source = listed.items.find((candidate) => candidate.id === input.originAudienceId);
  if (!source) return { ok: false as const, issues: [issue("SOURCE_NOT_ACCESSIBLE", "A origem escolhida não está acessível na conta atual.", "Escolha uma origem exibida na biblioteca desta conta e revise novamente.")] };
  const eligibility = assessLookalikeSource(source);
  if (!eligibility.ok) return { ok: false as const, issues: [issue(eligibility.code, eligibility.message, "Escolha outra origem elegível ou corrija a importação comprometida antes de revisar.")] };
  return { ok: true as const, source, formation: formation.formation, existingAudienceIds: listed.items.map((candidate) => candidate.id).sort() };
}

export async function reviewLookalikeAudience(input: LookalikeCommonInput): Promise<LookalikeAudienceReviewResult> {
  try {
    if (!input.name.trim()) return { ok: false, issues: [issue("NAME_REQUIRED", "O público precisa de um nome.", "Informe um nome antes de revisar.")] };
    const sourceResult = await readReviewSource(input);
    if (!sourceResult.ok) return sourceResult;
    const description = normalizedDescription(input.description);
    const command: LookalikeCommand = { operation: "create", adAccountId: input.adAccountId, originAudienceId: sourceResult.source.id, name: input.name.trim(), ...(description ? { description } : {}), formation: sourceResult.formation, existingAudienceIds: sourceResult.existingAudienceIds };
    const confirmationToken = JSON.stringify({ ...command, source: sourceSnapshot(sourceResult.source) });
    return { ok: true, operation: "create", adAccountId: input.adAccountId, source: { id: sourceResult.source.id, name: sourceResult.source.name, subtype: sourceResult.source.subtype }, formation: sourceResult.formation, confirmationToken, commandId: confirmationToken, state: "ready_to_submit", notice: "O percentual define o tamanho do público semelhante no país. Ele não mede confiança, correspondência nem pessoas importadas; a Meta decide a elegibilidade final." };
  } catch (error) {
    return { ok: false, issues: [issue("LOOKALIKE_REVIEW_FAILED", error instanceof Error ? error.message : "Não foi possível revisar o público semelhante.", "Corrija os dados e revise novamente.")] };
  }
}

export async function confirmLookalikeAudience(input: LookalikeConfirmInput): Promise<LookalikeAudienceMutationResult> {
  if (input.commandId && input.commandId !== input.confirmationToken) return fail([issue("COMMAND_ID_MISMATCH", "A identidade do comando não corresponde à revisão confirmada.", "Use a identidade retornada pela revisão atual.")]);
  const commandId = input.confirmationToken;
  const stored = input.commandStore ? await input.commandStore.get(commandId) : undefined;
  if (stored?.expired) return fail([expiredIssue()]);
  if (stored?.status === "completed" && stored.result) return stored.result as LookalikeAudienceMutationResult;
  if (stored?.status === "uncertain") return fail([uncertainIssue()]);
  const cached = completedCommands.get(commandId);
  if (cached) return cached;
  if (unresolvedCommands.has(commandId)) return fail([uncertainIssue()]);
  const previous = inFlightCommands.get(commandId);
  if (previous) return previous;
  const execution = (async (): Promise<LookalikeAudienceMutationResult> => {
    const reviewed = await reviewLookalikeAudience(input);
    if (!reviewed.ok) return fail(reviewed.issues);
    if (reviewed.confirmationToken !== commandId) return fail([issue("STALE_REVIEW", "A origem ou a formação mudou enquanto a confirmação era processada.", "Revise novamente antes de criar o público semelhante.")]);
    if (input.commandStore && input.actorUserId) {
      const claimed = await input.commandStore.claim({ commandId, actorUserId: input.actorUserId, accountId: input.adAccountId, audienceId: input.originAudienceId, request: { operation: "create", originAudienceId: input.originAudienceId, name: input.name.trim(), description: normalizedDescription(input.description), formation: reviewed.formation } });
      if (claimed.status === "completed" && claimed.result) return claimed.result as LookalikeAudienceMutationResult;
      if (claimed.status !== "pending" || claimed.acquired !== true) return fail([uncertainIssue()]);
    }
    const result = await createCustomAudience({ adAccountId: input.adAccountId, accessToken: input.accessToken, type: "lookalike", originAudienceId: reviewed.source.id, name: input.name.trim(), description: normalizedDescription(input.description), lookalikeCountry: reviewed.formation.country, lookalikeRatio: reviewed.formation.ratio });
    if (resultIsUncertain(result)) {
      unresolvedCommands.add(commandId);
      if (input.commandStore && input.actorUserId) await input.commandStore.markUncertain(commandId);
      return fail([uncertainIssue()]);
    }
    if (!result.ok) {
      const failed = fail(result.issues.map((candidate) => ({ stage: "create" as const, level: "audience" as const, ...candidate })));
      completedCommands.set(commandId, failed);
      if (input.commandStore && input.actorUserId) await input.commandStore.complete(commandId, failed);
      return failed;
    }
    const committed = ok(result.id, { id: result.id, state: "submitted" as const });
    completedCommands.set(commandId, committed);
    if (input.commandStore && input.actorUserId) await input.commandStore.complete(commandId, committed);
    return committed;
  })();
  inFlightCommands.set(commandId, execution);
  try { return await execution; } finally { if (inFlightCommands.get(commandId) === execution) inFlightCommands.delete(commandId); }
}

function matchesCreatedLookalike(input: LookalikeCommand, audience: { id: string; name?: string; description?: string; subtype?: string; originAudienceId?: string; lookalikeSpec?: unknown }): boolean {
  const spec = audience.lookalikeSpec;
  if (!spec || typeof spec !== "object") return false;
  const candidate = spec as { country?: unknown; ratio?: unknown };
  return audience.name === input.name && (audience.description ?? undefined) === input.description && audience.subtype === "LOOKALIKE" && audience.originAudienceId === input.originAudienceId && candidate.country === input.formation.country && candidate.ratio === input.formation.ratio;
}

export async function reconcileLookalikeAudience(input: LookalikeConfirmInput): Promise<LookalikeAudienceMutationResult> {
  if (input.commandId && input.commandId !== input.confirmationToken) return fail([issue("COMMAND_ID_MISMATCH", "A identidade do comando não corresponde à revisão confirmada.", "Use a identidade retornada pela revisão atual.")]);
  const commandId = input.confirmationToken;
  const stored = input.commandStore ? await input.commandStore.get(commandId) : undefined;
  if (stored?.expired) return fail([expiredIssue()]);
  if (stored?.status === "completed" && stored.result) return stored.result as LookalikeAudienceMutationResult;
  const cached = completedCommands.get(commandId);
  if (cached) return cached;
  const command = parseCommand(commandId);
  if (!command || command.adAccountId !== input.adAccountId || command.originAudienceId !== input.originAudienceId || command.name !== input.name.trim() || command.description !== normalizedDescription(input.description)) return fail([uncertainIssue()]);
  try {
    const listed = await listCustomAudiences({ adAccountId: input.adAccountId, accessToken: input.accessToken, detailed: true, importHistory: input.importHistory });
    if (listed.truncated) return fail([uncertainIssue()]);
    const matches = listed.items.filter((audience) => !command.existingAudienceIds.includes(audience.id) && matchesCreatedLookalike(command, audience));
    if (matches.length !== 1) return fail([uncertainIssue()]);
    const result = ok(matches[0].id, { id: matches[0].id, state: "submitted" as const, alreadyApplied: true });
    completedCommands.set(commandId, result);
    unresolvedCommands.delete(commandId);
    if (input.commandStore && input.actorUserId) await input.commandStore.complete(commandId, result);
    return result;
  } catch { return fail([uncertainIssue()]); }
}
