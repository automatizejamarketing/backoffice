import { metaApiCall } from "@/lib/meta-business/api";
import { GraphApiError } from "@/lib/meta-business/error";
import {
  type CreateIssue,
  type CreateResult,
  fail,
  localIssue,
  ok,
} from "../creation/types";
import { issuesFromError } from "../creation/normalize";
import { ensureObjectInAccount } from "../update/ownership";
import { type AudienceRuleInput, compileAudienceRule } from "./rule";
import type { AudienceCommandStore } from "./command-store";

export type AudienceKnownUse = {
  campaignId?: string;
  campaignName?: string;
  adSetId: string;
  adSetName?: string;
  placement: "include" | "exclude";
};

export type AudienceMetadataReview = {
  audienceId: string;
  adAccountId: string;
  audienceName?: string;
  before: { name?: string; description?: string };
  after: { name?: string; description?: string };
  confirmationToken: string;
  commandId: string;
  impact: {
    knownUses: AudienceKnownUse[];
    dependentAudienceIds: string[];
    coverage: "complete" | "incomplete";
    limitations: string[];
  };
};

export type AudienceMetadataReviewResult =
  | ({ ok: true } & AudienceMetadataReview)
  | { ok: false; issues: CreateIssue[] };

type AudienceMetadataMutationData = {
  id: string;
  alreadyApplied?: boolean;
  state?: "reconciliation_required";
};

const completedCommands = new Map<string, CreateResult<AudienceMetadataMutationData>>();
const unresolvedCommands = new Set<string>();
const inFlightCommands = new Map<string, Promise<CreateResult<AudienceMetadataMutationData>>>();

function requestedMetadataMatchesCurrent(input: {
  name?: string;
  description?: string;
  current: { name?: string; description?: string };
}): boolean {
  return (
    (input.name == null || input.name === input.current.name) &&
    (input.description == null || input.description === input.current.description)
  );
}

type AudienceSnapshot = {
  id?: string;
  account_id?: string;
  name?: string;
  description?: string;
  rule?: unknown;
  lookalike_audience_ids?: string[];
  permission_for_actions?: { can_edit?: boolean };
};

type AudienceUsesResponse = {
  data?: Array<{
    id?: string;
    name?: string;
    campaign?: { id?: string; name?: string };
    targeting?: {
      custom_audiences?: Array<{ id?: string }>;
      excluded_custom_audiences?: Array<{ id?: string }>;
    };
  }>;
  paging?: { next?: string };
};

function accountPath(accountId: string): string {
  return `act_${accountId.replace(/^act_/, "")}/adsets`;
}

function confirmationTokenFor(input: {
  audienceId: string;
  adAccountId: string;
  before: { name?: string; description?: string };
  after: { name?: string; description?: string };
  impact: AudienceMetadataReview["impact"];
}): string {
  return JSON.stringify(input);
}

function metadataCapabilityIssue(snapshot: AudienceSnapshot): CreateIssue[] {
  return snapshot.permission_for_actions?.can_edit !== true
    ? [{
        stage: "update",
        level: "audience",
        code: "META_CAPABILITY_UNAVAILABLE",
        reason: "A Meta não permite editar os metadados deste público com a conexão atual.",
        suggestion: "Confirme o compartilhamento/permissão do público no Gerenciador da Meta e revise novamente.",
      }]
    : [];
}

function mutationIsUncertain(error: unknown): boolean {
  if (error instanceof GraphApiError) {
    return Boolean(error.errorReturn.reason.isTransient) || error.errorReturn.statusCode >= 500;
  }
  return !(error instanceof Error && error.name === "MetaTokenInvalidError");
}

function uncertainMutationIssue(): CreateIssue {
  return {
    stage: "update",
    level: "audience",
    code: "META_MUTATION_UNCERTAIN",
    reason: "A resposta da Meta não confirmou se a alteração foi aplicada.",
    suggestion: "Não repita a confirmação. Consulte o estado do público para reconciliar o resultado antes de tentar outra ação.",
    transient: true,
  };
}
function expiredMutationIssue(): CreateIssue { return localIssue("audience", "COMMAND_EXPIRED", "A revisão do público expirou e não pode mais autorizar uma mutação.", "Revise o público novamente antes de confirmar ou reconciliar."); }

async function readAudience(
  audienceId: string,
  accessToken: string,
): Promise<AudienceSnapshot> {
  return metaApiCall<AudienceSnapshot>({
    method: "GET",
    path: audienceId,
    params: "fields=id,account_id,name,description,rule,lookalike_audience_ids,permission_for_actions",
    accessToken,
  });
}

async function readKnownUses(input: {
  audienceId: string;
  adAccountId: string;
  accessToken: string;
}): Promise<Pick<AudienceMetadataReview["impact"], "knownUses" | "coverage" | "limitations">> {
  const response = await metaApiCall<AudienceUsesResponse>({
    method: "GET",
    path: accountPath(input.adAccountId),
    params: "fields=id,name,campaign{id,name},targeting{custom_audiences,excluded_custom_audiences}&limit=200",
    accessToken: input.accessToken,
  });
  const knownUses = (response.data ?? []).flatMap((adSet) => {
    const adSetId = adSet.id;
    if (!adSetId) return [];
    return (["include", "exclude"] as const).flatMap((placement) => {
      const references =
        placement === "include"
          ? adSet.targeting?.custom_audiences
          : adSet.targeting?.excluded_custom_audiences;
      return references?.some((reference) => reference.id === input.audienceId)
        ? [{
            campaignId: adSet.campaign?.id,
            campaignName: adSet.campaign?.name,
            adSetId,
            adSetName: adSet.name,
            placement,
          }]
        : [];
    });
  });
  const incomplete = Boolean(response.paging?.next);
  return {
    knownUses,
    coverage: incomplete ? "incomplete" : "complete",
    limitations: incomplete
      ? ["A consulta de conjuntos tem mais páginas; usos não mostrados podem existir."]
      : ["A Meta não fornece garantia global de ausência de anúncios afetados."],
  };
}

export async function previewAudienceMetadataUpdate(input: {
  audienceId: string;
  adAccountId: string;
  accessToken: string;
  name?: string;
  description?: string;
  allowNoChange?: boolean;
}): Promise<AudienceMetadataReviewResult> {
  if (input.name == null && input.description == null && !input.allowNoChange) {
    return {
      ok: false,
      issues: [
        localIssue(
          "audience",
          "NOTHING_TO_UPDATE",
          "Nenhum metadado para atualizar foi informado.",
          "Informe nome ou descrição.",
        ),
      ],
    };
  }

  try {
    const snapshot = await readAudience(input.audienceId, input.accessToken);
    const ownership = await ensureObjectInAccount({
      objectId: input.audienceId,
      level: "audience",
      expectedAccountId: input.adAccountId,
      snapshotAccountId: snapshot.account_id,
      accessToken: input.accessToken,
    });
    if (ownership.length) return { ok: false, issues: ownership };
    const capabilityIssues = metadataCapabilityIssue(snapshot);
    if (capabilityIssues.length) return { ok: false, issues: capabilityIssues };

    const usageImpact = await readKnownUses({
      audienceId: input.audienceId,
      adAccountId: input.adAccountId,
      accessToken: input.accessToken,
    });
    const before = { name: snapshot.name, description: snapshot.description };
    const after = {
      name: input.name ?? snapshot.name,
      description: input.description ?? snapshot.description,
    };
    const impact: AudienceMetadataReview["impact"] = {
      ...usageImpact,
      dependentAudienceIds: snapshot.lookalike_audience_ids ?? [],
    };
    const confirmationToken = confirmationTokenFor({
      audienceId: input.audienceId,
      adAccountId: input.adAccountId,
      before,
      after,
      impact,
    });
    return {
      ok: true,
      audienceId: input.audienceId,
      adAccountId: input.adAccountId,
      audienceName: snapshot.name,
      before,
      after,
      confirmationToken,
      commandId: confirmationToken,
      impact,
    };
  } catch (error) {
    return { ok: false, issues: issuesFromError(error, "update", "audience") };
  }
}

export async function updateCustomAudience(input: {
  audienceId: string;
  adAccountId: string;
  accessToken: string;
  name?: string;
  description?: string;
  expectedBefore?: { name?: string; description?: string };
  expectedRule?: unknown;
  rule?: AudienceRuleInput;
  rawRule?: unknown;
}): Promise<CreateResult> {
  if (input.name == null && input.description == null && input.rule == null && input.rawRule === undefined) {
    return {
      ok: false,
      issues: [
        localIssue(
          "audience",
          "NOTHING_TO_UPDATE",
          "Nenhum metadado para atualizar foi informado.",
          "Informe nome ou descrição.",
        ),
      ],
    };
  }
  try {
    const snapshot = await readAudience(input.audienceId, input.accessToken);
    const ownership = await ensureObjectInAccount({
      objectId: input.audienceId,
      level: "audience",
      expectedAccountId: input.adAccountId,
      snapshotAccountId: snapshot.account_id,
      accessToken: input.accessToken,
    });
    if (ownership.length) return { ok: false, issues: ownership };
    const capabilityIssues = metadataCapabilityIssue(snapshot);
    if (capabilityIssues.length) return { ok: false, issues: capabilityIssues };
    if (input.expectedBefore && (snapshot.name !== input.expectedBefore.name || snapshot.description !== input.expectedBefore.description)) {
      return fail([localIssue("audience", "STALE_REVIEW", "Os metadados mudaram enquanto a confirmação era processada.", "Revise novamente antes de confirmar.")]);
    }
    if (input.expectedRule !== undefined && JSON.stringify(snapshot.rule) !== JSON.stringify(input.expectedRule)) {
      return fail([localIssue("audience", "STALE_REVIEW", "A regra mudou enquanto a confirmação era processada.", "Revise novamente antes de confirmar.")]);
    }

    const body = new URLSearchParams();
    if (input.name != null) body.set("name", input.name);
    if (input.description != null) body.set("description", input.description);
    if (input.rawRule !== undefined) {
      body.set("rule", JSON.stringify(input.rawRule));
    } else if (input.rule) {
      const compiled = compileAudienceRule(input.rule);
      if (!compiled.ok) return fail(compiled.issues);
      body.set("rule", JSON.stringify(compiled.rule));
    }
    await metaApiCall({
      method: "POST",
      path: input.audienceId,
      params: "",
      body,
      accessToken: input.accessToken,
    });
    return ok(input.audienceId, { id: input.audienceId });
  } catch (error) {
    if (mutationIsUncertain(error)) return fail([uncertainMutationIssue()]);
    return { ok: false, issues: issuesFromError(error, "update", "audience") };
  }
}

export async function confirmAudienceMetadataUpdate(input: {
  audienceId: string;
  adAccountId: string;
  accessToken: string;
  name?: string;
  description?: string;
  confirmationToken: string;
  commandId?: string;
  actorUserId?: string;
  commandStore?: AudienceCommandStore;
}): Promise<CreateResult<{ id: string; alreadyApplied?: boolean; state?: "reconciliation_required" }>> {
  if (input.commandId && input.commandId !== input.confirmationToken) {
    return fail([localIssue("audience", "COMMAND_ID_MISMATCH", "A identidade do comando não corresponde à revisão confirmada.", "Use a identidade retornada pela revisão atual.")]);
  }
  const commandId = input.confirmationToken;
  const stored = input.commandStore ? await input.commandStore.get(commandId) : undefined;
  if (stored?.expired) return fail([expiredMutationIssue()]);
  if (stored?.status === "completed" && stored.result) return stored.result as CreateResult<{ id: string; alreadyApplied?: boolean; state?: "reconciliation_required" }>;
  const cached = completedCommands.get(commandId);
  if (cached) return cached;
  if (unresolvedCommands.has(commandId)) return fail([uncertainMutationIssue()]);
  const previous = inFlightCommands.get(commandId);
  if (previous) return previous;

  const execution = (async () => {
    const review = await previewAudienceMetadataUpdate(input);
    if (!review.ok) return fail(review.issues);
    if (review.confirmationToken !== input.confirmationToken) {
      if (
        requestedMetadataMatchesCurrent({
          name: input.name,
          description: input.description,
          current: review.before,
        })
      ) {
        const alreadyApplied = ok(input.audienceId, { id: input.audienceId, alreadyApplied: true });
        if (input.commandStore && input.actorUserId) await input.commandStore.complete(commandId, alreadyApplied);
        return alreadyApplied;
      }
      return fail([
        localIssue(
          "audience",
          "STALE_REVIEW",
          "A revisão não corresponde mais à alteração solicitada.",
          "Revise novamente antes de confirmar.",
        ),
      ]);
    }
    if (input.commandStore && input.actorUserId) {
      const claimed = await input.commandStore.claim({ commandId, actorUserId: input.actorUserId, accountId: input.adAccountId, audienceId: input.audienceId, request: { name: input.name, description: input.description } });
      if (claimed.status === "completed" && claimed.result) return claimed.result as CreateResult<{ id: string; alreadyApplied?: boolean; state?: "reconciliation_required" }>;
      if (claimed.status !== "pending" || claimed.acquired !== true) return fail([uncertainMutationIssue()]);
    }
    const result = await updateCustomAudience({ ...input, expectedBefore: review.before });
    if (!result.ok && result.issues.some((issue) => issue.code === "META_MUTATION_UNCERTAIN")) {
      unresolvedCommands.add(commandId);
      if (input.commandStore && input.actorUserId) await input.commandStore.markUncertain(commandId);
    } else if (result.ok) {
      const completed = ok(input.audienceId, { id: input.audienceId, alreadyApplied: true }, result.warnings);
      completedCommands.set(commandId, completed);
      if (input.commandStore && input.actorUserId) await input.commandStore.complete(commandId, completed);
    }
    return result;
  })();
  inFlightCommands.set(commandId, execution);
  try {
    return await execution;
  } finally {
    if (inFlightCommands.get(commandId) === execution) inFlightCommands.delete(commandId);
  }
}

export async function reconcileAudienceMetadataUpdate(input: {
  audienceId: string;
  adAccountId: string;
  accessToken: string;
  name?: string;
  description?: string;
  confirmationToken: string;
  commandId?: string;
  actorUserId?: string;
  commandStore?: AudienceCommandStore;
}): Promise<CreateResult<{ id: string; alreadyApplied?: boolean; state?: "reconciliation_required" }>> {
  if (input.commandId && input.commandId !== input.confirmationToken) {
    return fail([localIssue("audience", "COMMAND_ID_MISMATCH", "A identidade do comando não corresponde à revisão confirmada.", "Use a identidade retornada pela revisão atual.")]);
  }
  const commandId = input.confirmationToken;
  const stored = input.commandStore ? await input.commandStore.get(commandId) : undefined;
  if (stored?.expired) return fail([expiredMutationIssue()]);
  if (stored?.status === "completed" && stored.result) return stored.result as CreateResult<{ id: string; alreadyApplied?: boolean; state?: "reconciliation_required" }>;
  const cached = completedCommands.get(commandId);
  if (cached) return cached;
  try {
    const snapshot = await readAudience(input.audienceId, input.accessToken);
    const ownership = await ensureObjectInAccount({
      objectId: input.audienceId,
      level: "audience",
      expectedAccountId: input.adAccountId,
      snapshotAccountId: snapshot.account_id,
      accessToken: input.accessToken,
    });
    if (ownership.length) return fail(ownership);
    if (!requestedMetadataMatchesCurrent({ name: input.name, description: input.description, current: snapshot })) {
      return fail([uncertainMutationIssue()]);
    }
    const result = ok(input.audienceId, { id: input.audienceId, alreadyApplied: true });
    completedCommands.set(commandId, result);
    if (input.commandStore && input.actorUserId) await input.commandStore.complete(commandId, result);
    unresolvedCommands.delete(commandId);
    return result;
  } catch (error) {
    return fail(issuesFromError(error, "update", "audience"));
  }
}
