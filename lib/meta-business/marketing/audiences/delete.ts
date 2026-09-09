import { metaApiCall } from "@/lib/meta-business/api";
import { GraphApiError } from "@/lib/meta-business/error";
import { type CreateIssue, localIssue } from "../creation/types";
import { issuesFromError } from "../creation/normalize";
import { ensureObjectInAccount } from "../update/ownership";

export type DeleteAudiencePreflight = {
  id: string; name?: string; approximateCountLowerBound?: number; approximateCountUpperBound?: number; retentionDays?: number;
  lookalikeAudienceIds: string[];
  knownUses: Array<{ campaignId?: string; campaignName?: string; adSetId: string; adSetName?: string; placement: "include" | "exclude" }>;
  coverage: "complete" | "incomplete"; limitations: string[]; confirmationToken: string;
};
export type DeleteCustomAudienceResult =
  | { ok: true; deleted: true; id: string }
  | { ok: true; deleted: false; requiresConfirmation: true; preflight: DeleteAudiencePreflight; message: string }
  | { ok: false; issues: CreateIssue[] };

type Snapshot = { id?: string; account_id?: string; name?: string; approximate_count_lower_bound?: number; approximate_count_upper_bound?: number; retention_days?: number; lookalike_audience_ids?: string[] };
type Uses = { data?: Array<{ id?: string; name?: string; campaign?: { id?: string; name?: string }; targeting?: { custom_audiences?: Array<{ id?: string }>; excluded_custom_audiences?: Array<{ id?: string }> } }>; paging?: { next?: string } };
const accountPath = (account: string) => `act_${account.replace(/^act_/, "")}/adsets`;

export async function deleteCustomAudience(input: { audienceId: string; accessToken: string; adAccountId?: string; confirm?: boolean; confirmationToken?: string }): Promise<DeleteCustomAudienceResult> {
  let snapshot: Snapshot;
  try { snapshot = await metaApiCall<Snapshot>({ method: "GET", path: input.audienceId, params: "fields=id,account_id,name,approximate_count_lower_bound,approximate_count_upper_bound,retention_days,lookalike_audience_ids", accessToken: input.accessToken }); }
  catch (error) { return { ok: false, issues: issuesFromError(error, "update", "audience") }; }
  const ownership = await ensureObjectInAccount({ objectId: input.audienceId, level: "audience", expectedAccountId: input.adAccountId, snapshotAccountId: snapshot.account_id, accessToken: input.accessToken });
  if (ownership.length) return { ok: false, issues: ownership };
  const lookalikes = snapshot.lookalike_audience_ids ?? [];
  if (lookalikes.length) return { ok: false, issues: [localIssue("audience", "SEED_HAS_LOOKALIKES", `Este público é semente de ${lookalikes.length} lookalike(s) e não pode ser excluído antes deles.`, `Exclua primeiro os públicos semelhantes: ${lookalikes.join(", ")}.`, ["lookalike_audience_ids"]) ] };
  let uses: Uses;
  try { uses = await metaApiCall<Uses>({ method: "GET", path: accountPath(input.adAccountId ?? snapshot.account_id ?? ""), params: "fields=id,name,campaign{id,name},targeting{custom_audiences,excluded_custom_audiences}&limit=200", accessToken: input.accessToken }); }
  catch (error) { return { ok: false, issues: issuesFromError(error, "update", "audience") }; }
  const knownUses = (uses.data ?? []).flatMap((adSet) => (["include", "exclude"] as const).flatMap((placement) => { const refs = placement === "include" ? adSet.targeting?.custom_audiences : adSet.targeting?.excluded_custom_audiences; return adSet.id && refs?.some((ref) => ref.id === input.audienceId) ? [{ campaignId: adSet.campaign?.id, campaignName: adSet.campaign?.name, adSetId: adSet.id, adSetName: adSet.name, placement }] : []; }));
  const withoutToken = { id: input.audienceId, name: snapshot.name, approximateCountLowerBound: snapshot.approximate_count_lower_bound, approximateCountUpperBound: snapshot.approximate_count_upper_bound, retentionDays: snapshot.retention_days, lookalikeAudienceIds: lookalikes, knownUses, coverage: uses.paging?.next ? "incomplete" as const : "complete" as const, limitations: uses.paging?.next ? ["A consulta possui mais páginas; podem existir usos não exibidos."] : ["A Meta não fornece garantia global de ausência de anúncios afetados."] };
  const preflight = { ...withoutToken, confirmationToken: JSON.stringify(withoutToken) };
  if (input.confirm !== true) return { ok: true, deleted: false, requiresConfirmation: true, preflight, message: `Excluir o público “${snapshot.name ?? input.audienceId}” é permanente; referências de campanha não serão removidas automaticamente. Confirme após revisar o impacto.` };
  if (input.confirmationToken !== undefined && input.confirmationToken !== preflight.confirmationToken) return { ok: false, issues: [localIssue("audience", "STALE_REVIEW", "A revisão de exclusão não corresponde mais ao impacto atual.", "Revise novamente antes de confirmar.")] };
  try { await metaApiCall({ method: "DELETE", path: input.audienceId, params: "", accessToken: input.accessToken }); return { ok: true, deleted: true, id: input.audienceId }; }
  catch (error) {
    try { await metaApiCall({ method: "GET", path: input.audienceId, params: "fields=id", accessToken: input.accessToken }); }
    catch (reconciled) { if (reconciled instanceof GraphApiError && reconciled.errorReturn.data?.code === 100) return { ok: true, deleted: true, id: input.audienceId }; }
    return { ok: false, issues: issuesFromError(error, "update", "audience") };
  }
}
