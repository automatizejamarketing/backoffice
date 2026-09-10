import "server-only";

import { type CreateIssue, type CreateResult, fail, localIssue, ok } from "../creation/types";
import { metaApiCall } from "@/lib/meta-business/api";
import { issuesFromError } from "../creation/normalize";
import { getCustomAudienceDetail, listCustomAudiences } from "./read";
import { buildWebsiteAudienceRule, parseWebsiteAudienceRule, resolveWebsiteSourceEvidence, validateWebsiteAudienceSelection, websiteAudienceRuleInput, WEBSITE_PERIOD_EVIDENCE, websitePeriodEvidenceFor, websitePeriodEvidenceStatus, websitePeriodSelectionsEqual, websiteSelectionsEqual, type WebsiteAudienceCriterion, type WebsiteAudienceSelection, type WebsiteSource, type WebsiteSourceEvidence } from "./website";
import { previewAudienceMetadataUpdate, updateCustomAudience } from "./update";
import type { AudienceCommandStore } from "./command-store";

export type WebsiteAudienceImpact = { knownUses: Array<{ campaignId?: string; campaignName?: string; adSetId: string; adSetName?: string; placement: "include" | "exclude" }>; dependentAudienceIds: string[]; coverage: "complete" | "incomplete"; limitations: string[] };
export type WebsiteAudienceReview = { ok: true; operation: "create" | "update"; audienceId?: string; adAccountId: string; audienceName?: string; audienceDescription?: string; beforeRule?: unknown; before: WebsiteAudienceSelection | null; after: WebsiteAudienceSelection; source: WebsiteSourceEvidence; periodEvidence: (typeof WEBSITE_PERIOD_EVIDENCE)[WebsiteAudienceCriterion]; impact: WebsiteAudienceImpact; confirmationToken: string; commandId: string; state: "ready_to_submit"; notice: string };
export type WebsiteAudienceReviewResult = WebsiteAudienceReview | { ok: false; issues: CreateIssue[] };
export type WebsiteAudienceMutationData = { id: string; state: "submitted"; alreadyApplied?: boolean };
export type WebsiteAudienceMutationResult = CreateResult<WebsiteAudienceMutationData>;
type CommonInput = { adAccountId: string; accessToken: string; name: string; description?: string; selection: WebsiteAudienceSelection; audienceId?: string; sources?: WebsiteSource[] };
type ConfirmInput = CommonInput & { confirmationToken: string; commandId?: string; actorUserId?: string; commandStore?: AudienceCommandStore };
const completedCommands = new Map<string, WebsiteAudienceMutationResult>();
const unresolvedCommands = new Set<string>();
const inFlightCommands = new Map<string, Promise<WebsiteAudienceMutationResult>>();
function issue(code: string, reason: string, suggestion: string): CreateIssue { return localIssue("audience", code, reason, suggestion); }
function uncertainIssue(): CreateIssue { return { stage: "update", level: "audience", code: "META_MUTATION_UNCERTAIN", reason: "A resposta da Meta não confirmou se o público do site foi criado ou atualizado.", suggestion: "Não repita a confirmação. Consulte a biblioteca e reconcilie o comando antes de tentar outra ação.", transient: true }; }
function expiredIssue(): CreateIssue { return issue("COMMAND_EXPIRED", "A revisão do público expirou e não pode mais autorizar uma mutação.", "Revise o público novamente antes de confirmar ou reconciliar."); }
function isUncertain(result: CreateResult) { return !result.ok && result.issues.some((candidate) => candidate.transient || candidate.code === "META_MUTATION_UNCERTAIN"); }
const REVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function reviewExpirationFromCommand(commandId: string): number | null { try { const expiresAt = (JSON.parse(commandId) as { expiresAt?: unknown }).expiresAt; if (typeof expiresAt !== "string") return null; const timestamp = Date.parse(expiresAt); return Number.isFinite(timestamp) ? timestamp : null; } catch { return null; } }
function reviewIsFresh(commandId: string): boolean { const expiresAt = reviewExpirationFromCommand(commandId); return expiresAt !== null && expiresAt > Date.now(); }
function reviewExpiresAt(input: ConfirmInput): string { const existing = reviewExpirationFromCommand(input.confirmationToken); return existing === null ? new Date(Date.now() + REVIEW_TTL_MS).toISOString() : new Date(existing).toISOString(); }
function descriptionMatches(input: ConfirmInput, current: { description?: string }, operation: "create" | "update", beforeDescription?: string) { return operation === "create" ? (current.description ?? undefined) === input.description : (current.description ?? undefined) === (input.description ?? beforeDescription); }
function beforeDescriptionFromCommand(commandId: string): { ok: true; value?: string } | { ok: false } { try { const parsed = JSON.parse(commandId) as { beforeDescription?: unknown }; if (parsed.beforeDescription !== null && parsed.beforeDescription !== undefined && typeof parsed.beforeDescription !== "string") return { ok: false }; return { ok: true, value: parsed.beforeDescription ?? undefined }; } catch { return { ok: false }; } }
function existingAudienceIdsFromCommand(commandId: string): Set<string> | null { try { const parsed = JSON.parse(commandId) as { operation?: unknown; existingAudienceIds?: unknown }; if (parsed.operation !== "create") return new Set(); if (!Array.isArray(parsed.existingAudienceIds) || parsed.existingAudienceIds.some((id) => typeof id !== "string")) return null; return new Set(parsed.existingAudienceIds); } catch { return null; } }
function createWebsiteAudience(input: { adAccountId: string; accessToken: string; name: string; description?: string; selection: WebsiteAudienceSelection }): Promise<CreateResult> {
  const body = new URLSearchParams({ name: input.name.trim(), rule: JSON.stringify(buildWebsiteAudienceRule(input.selection)), prefill: "true" });
  if (input.description) body.set("description", input.description);
  return metaApiCall<{ id?: string }>({ method: "POST", path: `act_${input.adAccountId.replace(/^act_/, "")}/customaudiences`, params: "", body, accessToken: input.accessToken }).then((created) => created.id ? ok(created.id, { id: created.id }) : fail([issue("META_CREATE_MISSING_ID", "A Meta não devolveu a identidade do público.", "Reconcilie a biblioteca antes de repetir a operação.")])).catch((error) => fail(issuesFromError(error, "create", "audience")));
}
export function websiteSourceEvidence(sources: WebsiteSource[], pixelId: string): WebsiteSourceEvidence { return resolveWebsiteSourceEvidence(sources, pixelId); }

export async function reviewWebsiteAudience(input: CommonInput): Promise<WebsiteAudienceReviewResult> {
  try {
    if (!input.name.trim()) return { ok: false, issues: [issue("NAME_REQUIRED", "O público precisa de um nome.", "Informe um nome antes de revisar.")] };
    const periodEvidence = websitePeriodEvidenceFor(input.selection.pixelId, input.selection.criterion);
    validateWebsiteAudienceSelection(input.selection);
    const source = resolveWebsiteSourceEvidence(input.sources ?? [], input.selection.pixelId);
    if (source.access !== "available") return { ok: false, issues: [issue("WEBSITE_SOURCE_UNAVAILABLE", source.guidance, "Escolha um Pixel acessível e configure o rastreamento existente.")] };
    if (source.activity !== "available") return { ok: false, issues: [issue("WEBSITE_ACTIVITY_UNAVAILABLE", source.guidance, "Confirme que o rastreamento existente recebeu atividade e revise novamente.")] };
    if (input.selection.criterion === "event" && (source.observedEventsStatus !== "available" || !source.observedEvents.includes(input.selection.event!))) return { ok: false, issues: [issue("WEBSITE_EVENT_UNCONFIRMED", "Este evento não foi observado como recebido pelo Pixel escolhido.", "Selecione somente um evento confirmado pela fonte; nenhum catálogo genérico é considerado evidência.")] };
    let before: WebsiteAudienceSelection | null = null;
    let audienceName: string | undefined;
    let audienceDescription: string | undefined;
    let beforeRule: unknown;
    let existingAudienceIds: string[] | undefined;
    let impact: WebsiteAudienceImpact = { knownUses: [], dependentAudienceIds: [], coverage: "complete", limitations: ["A criação ainda não tem usos ou dependências porque a identidade só será atribuída pela Meta após o POST."] };
    if (input.audienceId) {
      const audience = await getCustomAudienceDetail({ audienceId: input.audienceId, accessToken: input.accessToken });
      if (audience.capabilities.editMetadata !== "available" || audience.capabilities.editRule !== "available") return { ok: false, issues: [issue("META_CAPABILITY_UNAVAILABLE", "A Meta não confirmou permissão para editar a regra completa deste público.", "Reautorize ou compartilhe o público no Gerenciador e revise novamente.")] };
      before = parseWebsiteAudienceRule(audience.rule);
      if (!before) return { ok: false, issues: [issue("WEBSITE_RULE_NOT_REPRESENTABLE", "A regra atual contém condições externas ou não pode ser representada sem perda.", "Mantenha a regra externa intacta e edite-a no Gerenciador da Meta.")] };
      audienceName = audience.name;
      audienceDescription = audience.description;
      beforeRule = audience.rule;
      const metadata = await previewAudienceMetadataUpdate({ audienceId: input.audienceId, adAccountId: input.adAccountId, accessToken: input.accessToken, allowNoChange: true });
      if (!metadata.ok) return metadata;
      impact = metadata.impact;
    } else {
      const listed = await listCustomAudiences({ adAccountId: input.adAccountId, accessToken: input.accessToken, detailed: false });
      if (listed.truncated) return { ok: false, issues: [issue("WEBSITE_CREATE_BASELINE_INCOMPLETE", "Não foi possível obter a lista completa antes da criação para garantir a reconciliação do comando.", "Reduza temporariamente a biblioteca ou conclua a criação no Gerenciador da Meta.")] };
      existingAudienceIds = listed.items.map((audience) => audience.id);
    }
    if (websitePeriodEvidenceStatus(input.selection.criterion, periodEvidence) !== "ready" && !websitePeriodSelectionsEqual(before, input.selection)) return { ok: false, issues: [issue("WEBSITE_PERIOD_EVIDENCE_REQUIRED", "A combinação de origem, critério e período ainda não tem evidência fechada do Gerenciador da Meta.", "Não informe o período às cegas. Registre a observação da interface Meta por origem e critério antes de disponibilizar esta combinação.")] };
    const tokenSource = { access: source.access, activity: source.activity, availability: source.availability, observedEvents: source.observedEvents, observedEventsStatus: source.observedEventsStatus };
    const token = JSON.stringify({ operation: input.audienceId ? "update" : "create", expiresAt: reviewExpiresAt(input as ConfirmInput), ...(input.audienceId ? { audienceId: input.audienceId, beforeDescription: audienceDescription ?? null, beforeRule } : { existingAudienceIds, beforeDescription: null }), adAccountId: input.adAccountId, name: input.name.trim(), description: input.description, before, after: input.selection, source: tokenSource, periodEvidence, impact });
    return { ok: true, operation: input.audienceId ? "update" : "create", ...(input.audienceId ? { audienceId: input.audienceId } : {}), adAccountId: input.adAccountId, audienceName, audienceDescription, beforeRule, before, after: input.selection, source, periodEvidence, impact, confirmationToken: token, commandId: token, state: "ready_to_submit", notice: "A confirmação cria ou atualiza somente o público na biblioteca. A identidade e o processamento são retornados pela Meta; nenhum público é aplicado a campanhas." };
  } catch (error) { return { ok: false, issues: [issue("WEBSITE_REVIEW_FAILED", error instanceof Error ? error.message : "Não foi possível revisar o público do site.", "Corrija os dados e revise novamente.")] }; }
}

export async function confirmWebsiteAudience(input: ConfirmInput): Promise<WebsiteAudienceMutationResult> {
  if (input.commandId && input.commandId !== input.confirmationToken) return fail([issue("COMMAND_ID_MISMATCH", "A identidade do comando não corresponde à revisão confirmada.", "Use a identidade retornada pela revisão atual.")]);
  const commandId = input.confirmationToken;
  if (!reviewIsFresh(commandId)) return fail([expiredIssue()]);
  const stored = input.commandStore ? await input.commandStore.get(commandId) : undefined;
  if (stored?.expired) return fail([expiredIssue()]);
  if (stored?.status === "completed" && stored.result) return stored.result as WebsiteAudienceMutationResult;
  if (stored?.status === "uncertain") return fail([uncertainIssue()]);
  const cached = completedCommands.get(commandId);
  if (cached) return cached;
  if (unresolvedCommands.has(commandId)) return fail([uncertainIssue()]);
  const previous = inFlightCommands.get(commandId);
  if (previous) return previous;
  const execution = (async (): Promise<WebsiteAudienceMutationResult> => {
    const reviewed = await reviewWebsiteAudience(input);
    if (!reviewed.ok) return fail(reviewed.issues);
    const alreadyApplied = Boolean(input.audienceId && websiteSelectionsEqual(reviewed.before, input.selection) && input.name.trim() === (reviewed.audienceName ?? "") && input.description === undefined && reviewed.audienceDescription === undefined);
    if (reviewed.confirmationToken !== input.confirmationToken) return fail([issue("STALE_REVIEW", "A revisão não corresponde mais à regra atual do público.", "Revise novamente antes de confirmar.")]);
    if (input.commandStore && input.actorUserId) {
      const claimed = await input.commandStore.claim({ commandId, actorUserId: input.actorUserId, accountId: input.adAccountId, audienceId: input.audienceId ?? "pending", request: { operation: reviewed.operation, audienceId: input.audienceId, name: input.name, description: input.description, selection: input.selection } });
      if (claimed.status === "completed" && claimed.result) return claimed.result as WebsiteAudienceMutationResult;
      if (claimed.status !== "pending" || claimed.acquired !== true) return fail([uncertainIssue()]);
    }
    if (alreadyApplied) {
      const result = ok(input.audienceId!, { id: input.audienceId!, state: "submitted" as const, alreadyApplied: true });
      completedCommands.set(commandId, result);
      if (input.commandStore && input.actorUserId) await input.commandStore.complete(commandId, result);
      return result;
    }
    const result = input.audienceId
      ? await updateCustomAudience({ audienceId: input.audienceId, adAccountId: input.adAccountId, accessToken: input.accessToken, name: input.name.trim(), description: input.description, expectedBefore: { name: reviewed.audienceName, description: reviewed.audienceDescription }, expectedRule: reviewed.beforeRule, rawRule: websiteAudienceRuleInput(input.selection) })
      : await createWebsiteAudience({ adAccountId: input.adAccountId, accessToken: input.accessToken, name: input.name, description: input.description, selection: input.selection });
    if (isUncertain(result)) { unresolvedCommands.add(commandId); if (input.commandStore && input.actorUserId) await input.commandStore.markUncertain(commandId); return fail([uncertainIssue()]); }
    if (!result.ok) { completedCommands.set(commandId, result); if (input.commandStore && input.actorUserId) await input.commandStore.complete(commandId, result); return result; }
    const committed = ok(result.id, { id: result.id, state: "submitted" as const });
    completedCommands.set(commandId, committed);
    if (input.commandStore && input.actorUserId) await input.commandStore.complete(commandId, committed);
    return committed;
  })();
  inFlightCommands.set(commandId, execution);
  try { return await execution; } finally { if (inFlightCommands.get(commandId) === execution) inFlightCommands.delete(commandId); }
}

export async function reconcileWebsiteAudience(input: ConfirmInput): Promise<WebsiteAudienceMutationResult> {
  if (input.commandId && input.commandId !== input.confirmationToken) return fail([issue("COMMAND_ID_MISMATCH", "A identidade do comando não corresponde à revisão confirmada.", "Use a identidade retornada pela revisão atual.")]);
  const commandId = input.confirmationToken;
  if (!reviewIsFresh(commandId)) return fail([expiredIssue()]);
  const stored = input.commandStore ? await input.commandStore.get(commandId) : undefined;
  if (stored?.expired) return fail([expiredIssue()]);
  if (stored?.status === "completed" && stored.result) return stored.result as WebsiteAudienceMutationResult;
  const cached = completedCommands.get(commandId);
  if (cached) return cached;
  try {
    if (input.audienceId) {
      const beforeDescription = beforeDescriptionFromCommand(commandId);
      if (!beforeDescription.ok) return fail([uncertainIssue()]);
      const authorization = await previewAudienceMetadataUpdate({ audienceId: input.audienceId, adAccountId: input.adAccountId, accessToken: input.accessToken, allowNoChange: true });
      if (!authorization.ok) return fail(authorization.issues);
      const audience = await getCustomAudienceDetail({ audienceId: input.audienceId, accessToken: input.accessToken });
      if (websiteSelectionsEqual(parseWebsiteAudienceRule(audience.rule), input.selection) && input.name.trim() === (audience.name ?? "") && descriptionMatches(input, audience, "update", beforeDescription.value)) {
        const listed = await listCustomAudiences({ adAccountId: input.adAccountId, accessToken: input.accessToken, detailed: true });
        if (listed.truncated) return fail([uncertainIssue()]);
        const desiredDescription = input.description ?? beforeDescription.value;
        const collision = listed.items.some((candidate) => candidate.id !== input.audienceId && candidate.name === input.name.trim() && (candidate.description ?? undefined) === desiredDescription && websiteSelectionsEqual(parseWebsiteAudienceRule(candidate.rule), input.selection));
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
      const matches = listed.items.filter((audience) => !existingAudienceIds.has(audience.id) && audience.name === input.name.trim() && descriptionMatches(input, audience, "create") && websiteSelectionsEqual(parseWebsiteAudienceRule(audience.rule), input.selection));
      if (matches.length === 1) {
        const result = ok(matches[0].id, { id: matches[0].id, state: "submitted" as const, alreadyApplied: true });
        completedCommands.set(commandId, result);
        if (input.commandStore && input.actorUserId) await input.commandStore.complete(commandId, result);
        unresolvedCommands.delete(commandId);
        return result;
      }
    }
    return fail([uncertainIssue()]);
  } catch (error) { return fail([issue("RECONCILIATION_FAILED", error instanceof Error ? error.message : "Não foi possível consultar o estado do público.", "Tente reconciliar novamente quando a biblioteca estiver acessível.")]); }
}
