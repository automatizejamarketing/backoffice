"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  INSTAGRAM_AUDIENCE_CRITERIA,
  INSTAGRAM_PERIOD_EVIDENCE,
  instagramPeriodEvidenceByProfile,
  instagramPeriodEvidenceStatus,
  parseInstagramAudienceRule,
  type InstagramPeriodEvidence,
  type InstagramAudienceCriterion,
} from "@/lib/meta-business/marketing/audiences/instagram";
import type { CustomAudienceView } from "@/lib/meta-business/marketing/audiences/types";

type Profile = {
  id: string;
  username?: string;
  name?: string;
  source?: { access: string; activity: string; availability: string };
};

type Review = {
  ok: true;
  before: { criterion: InstagramAudienceCriterion; retentionDays: number } | null;
  after: { criterion: InstagramAudienceCriterion; retentionDays: number };
  source: { access: string; activity: string; availability: string };
  periodEvidence: { initialDays: number | null; metaMaximumDays: number | null; historicalFill: string };
  impact: { knownUses: Array<{ adSetId: string; adSetName?: string; placement: string }>; limitations: string[] };
  confirmationToken: string;
  commandId: string;
  notice: string;
};

type InstagramSourcesResponse = {
  profiles?: Profile[];
  periodEvidenceByProfile?: ReturnType<typeof instagramPeriodEvidenceByProfile>;
};

const criteria: Array<[InstagramAudienceCriterion, string]> = [
  ["all", "Atividade geral"],
  ["engaged", "Engajamento"],
  ["profile_visit", "Visitas ao perfil"],
  ["messaged", "Mensagens"],
  ["saved", "Salvamentos de publicações ou anúncios"],
];

const stateLabel = (value: string) => value === "available" ? "disponível" : value === "unavailable" ? "indisponível" : "não confirmada";

export function InstagramAudienceEditor({ accountId, userId, audience, onSaved }: { accountId: string; userId: string; audience?: CustomAudienceView; onSaved: () => void }) {
  const looksLikeInstagram = !audience || JSON.stringify(audience.rule ?? {}).includes('"type":"ig_business"');
  const parsed = audience ? parseInstagramAudienceRule(audience.rule) : null;
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [periodEvidenceByProfile, setPeriodEvidenceByProfile] = useState<ReturnType<typeof instagramPeriodEvidenceByProfile>>({});
  const [name, setName] = useState(audience?.name ?? "");
  const [profileId, setProfileId] = useState(parsed?.profileId ?? "");
  const [criterion, setCriterion] = useState<InstagramAudienceCriterion>(parsed?.criterion ?? "all");
  const [retentionDays, setRetentionDays] = useState(parsed ? String(parsed.retentionDays) : "");
  const [guidance, setGuidance] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (audience && !parsed) return;
    void fetch(`/api/meta-marketing/${accountId}/audiences?sources=instagram&userId=${encodeURIComponent(userId)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "Não foi possível consultar os perfis do Instagram.");
        const sources = body as InstagramSourcesResponse;
        setProfiles(sources.profiles ?? []);
        setPeriodEvidenceByProfile(sources.periodEvidenceByProfile ?? {});
        setGuidance(body.guidance ?? null);
        setProfileId((current) => current || parsed?.profileId || sources.profiles?.[0]?.id || "");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível consultar os perfis do Instagram."));
  }, [accountId, userId, audience?.id, parsed?.profileId]);

  const periodEvidence: InstagramPeriodEvidence =
    periodEvidenceByProfile[profileId]?.[criterion] ?? INSTAGRAM_PERIOD_EVIDENCE[criterion];
  const periodReady = instagramPeriodEvidenceStatus(criterion, periodEvidence) === "ready";
  const isCurrentPeriod = Boolean(
    audience && parsed && parsed.profileId === profileId && parsed.criterion === criterion,
  );

  useEffect(() => {
    if (isCurrentPeriod && parsed) {
      setRetentionDays(String(parsed.retentionDays));
      return;
    }
    setRetentionDays(periodEvidence.initialDays === null ? "" : String(periodEvidence.initialDays));
  }, [isCurrentPeriod, parsed?.retentionDays, periodEvidence.initialDays, profileId, criterion]);

  const send = async (action: "instagram-review" | "instagram-confirm" | "instagram-reconcile") => {
    setError(null);
    if (action === "instagram-review" && !periodReady && !isCurrentPeriod) {
      setError("Esta combinação está impedida: o Gerenciador da Meta ainda não tem evidência fechada de valor inicial, editabilidade, limites e preenchimento histórico. Nenhum período é solicitado às cegas.");
      return;
    }
    const days = Number(retentionDays);
    if (!name.trim() || !profileId || !Number.isInteger(days) || days < 1) {
      setError("Informe nome e perfil; o período só pode ser escolhido quando a evidência do Gerenciador estiver fechada.");
      return;
    }
    if (periodReady && periodEvidence.metaMinimumDays !== null && days < periodEvidence.metaMinimumDays) {
      setError(`O período deve ser de pelo menos ${periodEvidence.metaMinimumDays} dias para esta combinação.`);
      return;
    }
    if (periodReady && periodEvidence.metaMaximumDays !== null && days > periodEvidence.metaMaximumDays) {
      setError(`O período deve ser de no máximo ${periodEvidence.metaMaximumDays} dias para esta combinação.`);
      return;
    }
    if (action !== "instagram-review" && !review) {
      setError("Faça uma revisão nova antes de confirmar.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/meta-marketing/${accountId}/audiences?userId=${encodeURIComponent(userId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, audienceId: audience?.id, name, profileId, criterion, retentionDays: days, confirmationToken: review?.confirmationToken, commandId: review?.commandId }),
      });
      const body = await response.json().catch(() => ({}));
      if (action === "instagram-review") {
        if (!response.ok || !body.ok) throw new Error(body.message ?? body.issues?.[0]?.reason ?? "Não foi possível revisar o público.");
        setReview(body as Review);
        return;
      }
      if (!response.ok || !body.ok) {
        if (body.state === "reconciliation_required") {
          setError("A resposta foi incerta. Consulte a biblioteca para reconciliar antes de repetir.");
          return;
        }
        throw new Error(body.message ?? body.issues?.[0]?.reason ?? "Não foi possível salvar o público.");
      }
      setReview(null);
      if (!audience) { setName(""); setRetentionDays(""); }
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar o público.");
    } finally {
      setSaving(false);
    }
  };

  if (!looksLikeInstagram) return null;
  if (audience && !parsed) return <p className="text-xs text-muted-foreground">Regra externa: este editor não altera condições que não consegue representar sem perda. Edite-a no Gerenciador da Meta.</p>;

  const selectedProfile = profiles.find((profile) => profile.id === profileId);
  const periodEvidenceReady = periodReady || isCurrentPeriod;
  const periodBlocker = "O Gerenciador da Meta ainda não comprovou esta combinação de origem e critério. O período inicial, a edição, os limites e o preenchimento histórico permanecem desconhecidos; a criação ou a troca para esta combinação está impedida.";
  return (
    <details className="rounded-lg border bg-card p-4">
      <summary className="cursor-pointer font-medium">{audience ? "Editar regra do Instagram" : "Criar público do Instagram"}</summary>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm">Nome<input className="mt-1 w-full rounded border bg-background p-2" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="text-sm">Perfil<select className="mt-1 w-full rounded border bg-background p-2" value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.username ? `@${profile.username}` : profile.name ?? profile.id}</option>)}</select></label>
        <label className="text-sm">Critério<select className="mt-1 w-full rounded border bg-background p-2" value={criterion} onChange={(event) => setCriterion(event.target.value as InstagramAudienceCriterion)}>{criteria.map(([value, label]) => <option key={value} value={value}>{label} ({INSTAGRAM_AUDIENCE_CRITERIA[value]})</option>)}</select></label>
        {periodReady ? <label className="text-sm">Período de participação (dias)<Input className="mt-1 w-full rounded border bg-background p-2" type="number" inputMode="numeric" min={periodEvidence.metaMinimumDays ?? 1} max={periodEvidence.metaMaximumDays ?? undefined} value={retentionDays} onChange={(event) => setRetentionDays(event.target.value)} /></label> : isCurrentPeriod ? <div className="text-sm"><span className="block">Período real do objeto</span><Input aria-label="Período real do objeto" className="mt-1 block w-full rounded border bg-muted/30 p-2" type="number" value={parsed?.retentionDays ?? ""} readOnly /></div> : <div className="text-sm"><span className="block">Período de participação</span><p className="mt-1 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">Impedido até a evidência do Gerenciador. O formulário não pede um número para descobrir sozinho.</p></div>}
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-muted-foreground md:grid-cols-2"><div><dt className="inline font-medium">Valor inicial:</dt>{" "}<dd className="inline">{periodEvidence.initialDays === null ? "não comprovado" : `${periodEvidence.initialDays} dias`}</dd></div><div><dt className="inline font-medium">Editável:</dt>{" "}<dd className="inline">{periodEvidence.editable === "unknown" ? "não comprovado" : periodEvidence.editable === "yes" ? "sim" : "não"}</dd></div><div><dt className="inline font-medium">Limites Meta:</dt>{" "}<dd className="inline">{periodEvidence.metaMinimumDays === null && periodEvidence.metaMaximumDays === null ? "não comprovados" : `${periodEvidence.metaMinimumDays ?? "sem mínimo"}–${periodEvidence.metaMaximumDays ?? "sem máximo"} dias`}</dd></div><div><dt className="inline font-medium">Limite local:</dt>{" "}<dd className="inline">{periodEvidence.localValidationMaximumDays === null ? "não imposto" : `${periodEvidence.localValidationMaximumDays} dias`}</dd></div><div><dt className="inline font-medium">Unidade enviada:</dt>{" "}<dd className="inline">{periodEvidence.unit} (retention_seconds)</dd></div><div><dt className="inline font-medium">Preenchimento histórico:</dt>{" "}<dd className="inline">{stateLabel(periodEvidence.historicalFill)}</dd></div></dl>
      {!periodReady && !isCurrentPeriod ? <p role="alert" className="mt-2 text-sm text-amber-700">{periodBlocker} Evidência registrada em {periodEvidence.observedAt}; origem: {periodEvidence.source}</p> : null}
      {isCurrentPeriod && !periodReady ? <p role="status" className="mt-2 text-sm text-muted-foreground">O período real de {parsed?.retentionDays} dias foi carregado do objeto e será preservado. A alteração de perfil ou critério exige evidência própria e não reutiliza este valor.</p> : null}
      {selectedProfile?.source ? <p className="mt-2 text-xs text-muted-foreground">Fonte: {stateLabel(selectedProfile.source.access)} · atividade: {stateLabel(selectedProfile.source.activity)} · disponibilidade: {stateLabel(selectedProfile.source.availability)}</p> : null}
      {guidance ? <p role="status" className="mt-3 text-sm text-muted-foreground">{guidance}</p> : null}
      {review ? <div className="mt-4 space-y-2 rounded border bg-muted/20 p-3 text-sm"><p className="font-medium">Revisão pronta para confirmação</p><p>Antes: {review.before ? `${review.before.criterion}, ${review.before.retentionDays} dias` : "público inexistente"} · depois: {review.after.criterion}, {review.after.retentionDays} dias.</p><p>Fonte: {stateLabel(review.source.access)} · atividade: {stateLabel(review.source.activity)} · disponibilidade: {stateLabel(review.source.availability)}.</p><p>{review.notice}</p><p className="text-xs text-muted-foreground">Período inicial: {review.periodEvidence.initialDays ?? "não registrado"}; limite Meta específico: {review.periodEvidence.metaMaximumDays ?? "não confirmado"}; preenchimento histórico: {stateLabel(review.periodEvidence.historicalFill)}.</p>{review.impact.knownUses.length ? <p className="text-xs text-muted-foreground">Usos conhecidos: {review.impact.knownUses.map((use) => `${use.adSetName ?? use.adSetId} (${use.placement})`).join(", ")}</p> : null}{review.impact.limitations.map((limitation) => <p key={limitation} className="text-xs text-muted-foreground">{limitation}</p>)}<div className="flex flex-wrap gap-2"><Button type="button" onClick={() => void send("instagram-confirm")} disabled={saving}>{saving ? "Salvando..." : "Confirmar"}</Button><Button type="button" variant="outline" onClick={() => void send("instagram-review")} disabled={saving || !periodEvidenceReady}>Revisar novamente</Button></div></div> : <Button type="button" className="mt-4" onClick={() => void send("instagram-review")} disabled={saving || profiles.length === 0 || !periodEvidenceReady}>{saving ? "Revisando..." : "Revisar"}</Button>}
      {error ? <div className="mt-3 space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p>{review ? <Button type="button" variant="outline" onClick={() => void send("instagram-reconcile")} disabled={saving}>Reconciliar resultado</Button> : null}</div> : null}
    </details>
  );
}
