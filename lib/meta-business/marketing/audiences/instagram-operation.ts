import "server-only";

import { type CreateIssue, type CreateResult, fail, localIssue, ok } from "../creation/types";
import { metaApiCall } from "@/lib/meta-business/api";
import { issuesFromError } from "../creation/normalize";
import { getCustomAudienceDetail, listCustomAudiences } from "./read";
import { buildInstagramAudienceRule, INSTAGRAM_PERIOD_EVIDENCE, instagramAudienceRuleInput, instagramPeriodEvidenceFor, instagramPeriodEvidenceStatus, parseInstagramAudienceRule, resolveInstagramSourceEvidence, type InstagramAudienceSelection, type InstagramSourceEvidence, validateInstagramAudienceSelection } from "./instagram";
import { previewAudienceMetadataUpdate, updateCustomAudience } from "./update";
import type { AudienceCommandStore } from "./command-store";

export type InstagramSourceProfile = { id: string; username?: string; name?: string };
export type InstagramAudienceImpact = {
  knownUses: Array<{ campaignId?: string; campaignName?: string; adSetId: string; adSetName?: string; placement: "include" | "exclude" }>;
  dependentAudienceIds: string[];
  coverage: "complete" | "incomplete";
  limitations: string[];
};
export type InstagramAudienceReview = {
  ok: true;
  operation: "create" | "update";
  audienceId?: string;
  adAccountId: string;
  audienceName?: string;
  audienceDescription?: string;
  beforeRule?: unknown;
  before: InstagramAudienceSelection | null;
  after: InstagramAudienceSelection;
  source: InstagramSourceEvidence;
  periodEvidence: (typeof INSTAGRAM_PERIOD_EVIDENCE)[keyof typeof INSTAGRAM_PERIOD_EVIDENCE];
  impact: InstagramAudienceImpact;
  confirmationToken: string;
  commandId: string;
  state: "ready_to_submit";
  notice: string;
};
export type InstagramAudienceReviewResult = InstagramAudienceReview | { ok: false; issues: CreateIssue[] };
export type InstagramAudienceMutationData = { id: string; state: "submitted"; alreadyApplied?: boolean };
export type InstagramAudienceMutationResult = CreateResult<InstagramAudienceMutationData>;

type CommonInput = { adAccountId: string; accessToken: string; name: string; description?: string; selection: InstagramAudienceSelection; audienceId?: string; profiles?: InstagramSourceProfile[] };
type ConfirmInput = CommonInput & { confirmationToken: string; commandId?: string; actorUserId?: string; commandStore?: AudienceCommandStore };

const completedCommands = new Map<string, InstagramAudienceMutationResult>();
const unresolvedCommands = new Set<string>();
const inFlightCommands = new Map<string, Promise<InstagramAudienceMutationResult>>();

function issue(code: string, reason: string, suggestion: string): CreateIssue { return localIssue("audience", code, reason, suggestion); }
export function instagramSourceEvidence(profiles: InstagramSourceProfile[], profileId: string): InstagramSourceEvidence { return resolveInstagramSourceEvidence(profiles, profileId); }
function sameSelection(left: InstagramAudienceSelection | null | undefined, right: InstagramAudienceSelection) { return Boolean(left && left.profileId === right.profileId && left.criterion === right.criterion && left.retentionDays === right.retentionDays); }
function descriptionMatches(input: ConfirmInput, current: { description?: string }, operation: "create" | "update", beforeDescription?: string) { return operation === "create" ? (current.description ?? undefined) === input.description : (current.description ?? undefined) === (input.description ?? beforeDescription); }
function beforeDescriptionFromCommand(commandId: string): { ok: true; value?: string } | { ok: false } { try { const parsed = JSON.parse(commandId) as { beforeDescription?: unknown }; if (parsed.beforeDescription !== null && parsed.beforeDescription !== undefined && typeof parsed.beforeDescription !== "string") return { ok: false }; return { ok: true, value: parsed.beforeDescription ?? undefined }; } catch { return { ok: false }; } }
function uncertainIssue(): CreateIssue { return { stage: "update", level: "audience", code: "META_MUTATION_UNCERTAIN", reason: "A resposta da Meta não confirmou se o público foi criado ou atualizado.", suggestion: "Não repita a confirmação. Consulte a biblioteca e reconcilie o comando antes de tentar outra ação.", transient: true }; }
function expiredIssue(): CreateIssue { return localIssue("audience", "COMMAND_EXPIRED", "A revisão do público expirou e não pode mais autorizar uma mutação.", "Revise o público novamente antes de confirmar ou reconciliar."); }
function isUncertain(result: CreateResult) { return !result.ok && result.issues.some((candidate) => candidate.transient || candidate.code === "META_MUTATION_UNCERTAIN"); }
function existingAudienceIdsFromCommand(commandId: string): Set<string> | null {
  try {
    const parsed = JSON.parse(commandId) as { operation?: unknown; existingAudienceIds?: unknown };
    if (parsed.operation !== "create") return new Set();
    if (!Array.isArray(parsed.existingAudienceIds) || parsed.existingAudienceIds.some((id) => typeof id !== "string")) return null;
    return new Set(parsed.existingAudienceIds);
  } catch {
    return null;
  }
}
async function createInstagramAudience(input: { adAccountId: string; accessToken: string; name: string; description?: string; selection: InstagramAudienceSelection }): Promise<CreateResult> {
  const body = new URLSearchParams({ name: input.name.trim(), rule: JSON.stringify(buildInstagramAudienceRule(input.selection)), prefill: "true" });
  if (input.description) body.set("description", input.description);
  try {
    const created = await metaApiCall<{ id?: string }>({ method: "POST", path: `act_${input.adAccountId.replace(/^act_/, "")}/customaudiences`, params: "", body, accessToken: input.accessToken });
    return created.id ? ok(created.id, { id: created.id }) : fail([issue("META_CREATE_MISSING_ID", "A Meta não devolveu a identidade do público.", "Reconcilie a biblioteca antes de repetir a operação.")]);
  } catch (error) { return fail(issuesFromError(error, "create", "audience")); }
}

export async function reviewInstagramAudience(input: CommonInput): Promise<InstagramAudienceReviewResult> {
  try {
    if (!input.name.trim()) return { ok: false, issues: [issue("NAME_REQUIRED", "O público precisa de um nome.", "Informe um nome antes de revisar.")] };
    const periodEvidence = instagramPeriodEvidenceFor(input.selection.profileId, input.selection.criterion);
    validateInstagramAudienceSelection(input.selection);
    const source = resolveInstagramSourceEvidence(input.profiles ?? [], input.selection.profileId);
    if (source.access !== "available") return { ok: false, issues: [issue("INSTAGRAM_SOURCE_UNAVAILABLE", source.guidance, "Escolha um perfil profissional retornado pela descoberta desta conta.")] };
    let before: InstagramAudienceSelection | null = null;
    let audienceName: string | undefined;
    let audienceDescription: string | undefined;
    let beforeRule: unknown;
    let impact: InstagramAudienceImpact = { knownUses: [], dependentAudienceIds: [], coverage: "complete", limitations: ["A criação ainda não tem usos ou dependências porque a identidade só será atribuída pela Meta após o POST."] };
    let existingAudienceIds: string[] | undefined;
    if (input.audienceId) {
      const audience = await getCustomAudienceDetail({ audienceId: input.audienceId, accessToken: input.accessToken });
      if (audience.capabilities.editMetadata !== "available" || audience.capabilities.editRule !== "available") return { ok: false, issues: [issue("META_CAPABILITY_UNAVAILABLE", "A Meta não confirmou permissão para editar a regra completa deste público.", "Reautorize ou compartilhe o público no Gerenciador e revise novamente.")] };
      before = parseInstagramAudienceRule(audience.rule);
      if (!before) return { ok: false, issues: [issue("INSTAGRAM_RULE_NOT_REPRESENTABLE", "A regra atual contém condições externas ou não pode ser representada sem perda.", "Mantenha a regra externa intacta e edite-a no Gerenciador da Meta.")] };
      audienceName = audience.name;
      audienceDescription = audience.description;
      beforeRule = audience.rule;
      const metadata = await previewAudienceMetadataUpdate({ audienceId: input.audienceId, adAccountId: input.adAccountId, accessToken: input.accessToken, allowNoChange: true });
      if (!metadata.ok) return metadata;
      impact = metadata.impact;
    } else {
      const listed = await listCustomAudiences({ adAccountId: input.adAccountId, accessToken: input.accessToken, detailed: false });
      if (listed.truncated) return { ok: false, issues: [issue("INSTAGRAM_CREATE_BASELINE_INCOMPLETE", "Não foi possível obter a lista completa antes da criação para garantir a reconciliação do comando.", "Reduza temporariamente a biblioteca ou conclua a criação no Gerenciador da Meta.")] };
      existingAudienceIds = listed.items.map((audience) => audience.id);
    }
    if (instagramPeriodEvidenceStatus(input.selection.criterion, periodEvidence) !== "ready" && !sameSelection(before, input.selection)) return { ok: false, issues: [issue("INSTAGRAM_PERIOD_EVIDENCE_REQUIRED", "A combinação de critério e período ainda não tem evidência fechada do Gerenciador da Meta.", "Não informe o período às cegas. Registre a observação da interface Meta por critério antes de disponibilizar esta combinação.")] };
    const tokenInput = { operation: input.audienceId ? "update" as const : "create" as const, ...(input.audienceId ? { audienceId: input.audienceId, beforeDescription: audienceDescription ?? null, beforeRule } : { existingAudienceIds }), adAccountId: input.adAccountId, name: input.name.trim(), ...(input.description !== undefined ? { description: input.description } : {}), before, after: input.selection, source, impact };
    const confirmationToken = JSON.stringify(tokenInput);
    return { ok: true, operation: tokenInput.operation, ...(input.audienceId ? { audienceId: input.audienceId } : {}), adAccountId: input.adAccountId, audienceName, audienceDescription, beforeRule, before, after: input.selection, source, periodEvidence, impact, confirmationToken, commandId: confirmationToken, state: "ready_to_submit", notice: "A confirmação cria ou atualiza somente o público na biblioteca. A identidade e o processamento são retornados pela Meta; nenhum público é aplicado a campanhas." };
  } catch (error) {
    return { ok: false, issues: [issue("INSTAGRAM_REVIEW_FAILED", error instanceof Error ? error.message : "Não foi possível revisar o público do Instagram.", "Corrija os dados e revise novamente.")] };
  }
}

export async function confirmInstagramAudience(input: ConfirmInput): Promise<InstagramAudienceMutationResult> {
  if (input.commandId && input.commandId !== input.confirmationToken) return fail([issue("COMMAND_ID_MISMATCH", "A identidade do comando não corresponde à revisão confirmada.", "Use a identidade retornada pela revisão atual.")]);
  const commandId = input.confirmationToken;
  const stored = input.commandStore ? await input.commandStore.get(commandId) : undefined;
  if (stored?.expired) return fail([expiredIssue()]);
  if (stored?.status === "completed" && stored.result) return stored.result as InstagramAudienceMutationResult;
  if (stored?.status === "uncertain") return fail([uncertainIssue()]);
  const cached = completedCommands.get(commandId);
  if (cached) return cached;
  if (unresolvedCommands.has(commandId)) return fail([uncertainIssue()]);
  const previous = inFlightCommands.get(commandId);
  if (previous) return previous;
  const execution = (async (): Promise<InstagramAudienceMutationResult> => {
    const reviewed = await reviewInstagramAudience(input);
    if (!reviewed.ok) return fail(reviewed.issues);
    const alreadyApplied = Boolean(input.audienceId && sameSelection(reviewed.before, input.selection) && input.name.trim() === (reviewed.audienceName ?? "") && input.description === undefined && reviewed.audienceDescription === undefined);
    if (reviewed.confirmationToken !== input.confirmationToken) return fail([issue("STALE_REVIEW", "A revisão não corresponde mais à regra atual do público.", "Revise novamente antes de confirmar.")]);
    if (input.commandStore && input.actorUserId) {
      const claimed = await input.commandStore.claim({ commandId, actorUserId: input.actorUserId, accountId: input.adAccountId, audienceId: input.audienceId ?? "pending", request: { operation: reviewed.operation, audienceId: input.audienceId, name: input.name, description: input.description, selection: input.selection } });
      if (claimed.status === "completed" && claimed.result) return claimed.result as InstagramAudienceMutationResult;
      if (claimed.status !== "pending" || claimed.acquired !== true) return fail([uncertainIssue()]);
    }
    if (alreadyApplied) {
      const result = ok(input.audienceId!, { id: input.audienceId!, state: "submitted" as const, alreadyApplied: true });
      completedCommands.set(commandId, result);
      if (input.commandStore && input.actorUserId) await input.commandStore.complete(commandId, result);
      return result;
    }
    const rule = instagramAudienceRuleInput(input.selection);
    const result = input.audienceId
      ? await updateCustomAudience({ audienceId: input.audienceId, adAccountId: input.adAccountId, accessToken: input.accessToken, name: input.name.trim(), description: input.description, expectedBefore: { name: reviewed.audienceName, description: reviewed.audienceDescription }, expectedRule: reviewed.beforeRule, rule })
      : await createInstagramAudience({ adAccountId: input.adAccountId, accessToken: input.accessToken, name: input.name, description: input.description, selection: input.selection });
    if (isUncertain(result)) {
      unresolvedCommands.add(commandId);
      if (input.commandStore && input.actorUserId) await input.commandStore.markUncertain(commandId);
      return fail([uncertainIssue()]);
    }
    if (!result.ok) {
      completedCommands.set(commandId, result);
      if (input.commandStore && input.actorUserId) await input.commandStore.complete(commandId, result);
      return result;
    }
    const committed = ok(result.id, { id: result.id, state: "submitted" as const });
    completedCommands.set(commandId, committed);
    if (input.commandStore && input.actorUserId) await input.commandStore.complete(commandId, committed);
    return committed;
  })();
  inFlightCommands.set(commandId, execution);
  try { return await execution; } finally { if (inFlightCommands.get(commandId) === execution) inFlightCommands.delete(commandId); }
}

export async function reconcileInstagramAudience(input: ConfirmInput): Promise<InstagramAudienceMutationResult> {
  if (input.commandId && input.commandId !== input.confirmationToken) return fail([issue("COMMAND_ID_MISMATCH", "A identidade do comando não corresponde à revisão confirmada.", "Use a identidade retornada pela revisão atual.")]);
  const commandId = input.confirmationToken;
  const stored = input.commandStore ? await input.commandStore.get(commandId) : undefined;
  if (stored?.expired) return fail([expiredIssue()]);
  if (stored?.status === "completed" && stored.result) return stored.result as InstagramAudienceMutationResult;
  const cached = completedCommands.get(commandId);
  if (cached) return cached;
  try {
    if (input.audienceId) {
      const beforeDescription = beforeDescriptionFromCommand(commandId);
      if (!beforeDescription.ok) return fail([uncertainIssue()]);
      const authorization = await previewAudienceMetadataUpdate({ audienceId: input.audienceId, adAccountId: input.adAccountId, accessToken: input.accessToken, allowNoChange: true });
      if (!authorization.ok) return fail(authorization.issues);
      const audience = await getCustomAudienceDetail({ audienceId: input.audienceId, accessToken: input.accessToken });
      if (sameSelection(parseInstagramAudienceRule(audience.rule), input.selection) && input.name.trim() === (audience.name ?? "") && descriptionMatches(input, audience, "update", beforeDescription.value)) {
        const listed = await listCustomAudiences({ adAccountId: input.adAccountId, accessToken: input.accessToken, detailed: true });
        if (listed.truncated) return fail([uncertainIssue()]);
        const desiredDescription = input.description ?? beforeDescription.value;
        const collision = listed.items.some((candidate) => candidate.id !== input.audienceId && candidate.name === input.name.trim() && (candidate.description ?? undefined) === desiredDescription && sameSelection(parseInstagramAudienceRule(candidate.rule), input.selection));
        if (collision) return fail([uncertainIssue()]);
        const result = ok(input.audienceId, { id: input.audienceId, state: "submitted" as const, alreadyApplied: true });
        completedCommands.set(commandId, result);
        if (input.commandStore && input.actorUserId) await input.commandStore.complete(commandId, result);
        unresolvedCommands.delete(commandId);
        return result;
      }
    } else {
      const existingAudienceIds = existingAudienceIdsFromCommand(commandId);
      if (!existingAudienceIds) return fail([uncertainIssue()]);
      const listed = await listCustomAudiences({ adAccountId: input.adAccountId, accessToken: input.accessToken, detailed: true });
      if (listed.truncated) return fail([uncertainIssue()]);
      const matches = listed.items.filter((audience) => !existingAudienceIds.has(audience.id) && audience.name === input.name.trim() && descriptionMatches(input, audience, "create") && sameSelection(parseInstagramAudienceRule(audience.rule), input.selection));
      if (matches.length === 1) {
        const result = ok(matches[0].id, { id: matches[0].id, state: "submitted" as const, alreadyApplied: true });
        completedCommands.set(commandId, result);
        if (input.commandStore && input.actorUserId) await input.commandStore.complete(commandId, result);
        unresolvedCommands.delete(commandId);
        return result;
      }
    }
    return fail([uncertainIssue()]);
  } catch (error) {
    return fail([issue("RECONCILIATION_FAILED", error instanceof Error ? error.message : "Não foi possível consultar o estado do público.", "Tente reconciliar novamente quando a biblioteca estiver acessível.")]);
  }
}
