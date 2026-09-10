"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseWebsiteAudienceRule, WEBSITE_PERIOD_EVIDENCE, websitePeriodEvidenceStatus, type WebsiteAudienceCriterion, type WebsitePeriodEvidence } from "@/lib/meta-business/marketing/audiences/website";
import type { CustomAudienceView } from "@/lib/meta-business/marketing/audiences/types";

type Source = { id: string; name?: string; lastFiredTime?: string; source?: { access: string; activity: string; availability: string; observedEvents: string[]; observedEventsStatus?: string; guidance: string } };
type WebsiteSourcesResponse = { sources?: Source[]; periodEvidence?: Record<string, Record<WebsiteAudienceCriterion, WebsitePeriodEvidence>> };
type Review = { ok: true; before: { pixelId: string; criterion: WebsiteAudienceCriterion; retentionDays: number; url?: string; event?: string } | null; after: { pixelId: string; criterion: WebsiteAudienceCriterion; retentionDays: number; url?: string; event?: string }; source: { access: string; activity: string; availability: string; observedEvents: string[]; guidance: string }; periodEvidence: { initialDays: number | null; metaMaximumDays: number | null; historicalFill: string }; impact: { knownUses: Array<{ adSetId: string; adSetName?: string; placement: string }>; limitations: string[] }; confirmationToken: string; commandId: string; notice: string };
const stateLabel = (value: string) => value === "available" ? "disponível" : value === "unavailable" ? "indisponível" : "não confirmada";

export function WebsiteAudienceEditor({ accountId, userId, audience, onSaved }: { accountId: string; userId: string; audience?: CustomAudienceView; onSaved: () => void }) {
  const current = audience?.rule ? parseWebsiteAudienceRule(audience.rule) : null;
  const [sources, setSources] = useState<Source[]>([]);
  const [periodEvidenceBySource, setPeriodEvidenceBySource] = useState<Record<string, Record<WebsiteAudienceCriterion, WebsitePeriodEvidence>>>({});
  const [guidance, setGuidance] = useState<string | null>(null);
  const [name, setName] = useState(audience?.name ?? "");
  const [pixelId, setPixelId] = useState(current?.pixelId ?? "");
  const [criterion, setCriterion] = useState<WebsiteAudienceCriterion>(current?.criterion ?? "visitors");
  const [retentionDays, setRetentionDays] = useState(current?.retentionDays ? String(current.retentionDays) : "");
  const [url, setUrl] = useState(current?.url ?? "");
  const [event, setEvent] = useState(current?.event ?? "");
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch(`/api/meta-marketing/${accountId}/audiences?userId=${encodeURIComponent(userId)}&sources=website`)
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.message ?? "Não foi possível consultar as fontes do site."); const sourcesResponse = body as WebsiteSourcesResponse; setSources(sourcesResponse.sources ?? []); setPeriodEvidenceBySource(sourcesResponse.periodEvidence ?? {}); setGuidance(body.guidance ?? null); setPixelId((value) => value || sourcesResponse.sources?.[0]?.id || ""); })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível consultar as fontes do site."));
  }, [accountId, userId]);

  const selectedSource = sources.find((source) => source.id === pixelId);
  const observedEvents = Array.from(new Set(selectedSource?.source?.observedEvents ?? []));
  const eventsConfirmed = selectedSource?.source?.observedEventsStatus === "available" && observedEvents.length > 0;
  const eventReady = criterion !== "event" || eventsConfirmed;
  const evidence = periodEvidenceBySource[pixelId]?.[criterion] ?? WEBSITE_PERIOD_EVIDENCE[criterion];
  const periodReady = websitePeriodEvidenceStatus(criterion, evidence) === "ready";
  const isCurrentPeriod = Boolean(
    audience && current && current.pixelId === pixelId && current.criterion === criterion,
  );

  useEffect(() => {
    if (isCurrentPeriod && current) {
      setRetentionDays(String(current.retentionDays));
      return;
    }
    setRetentionDays(evidence.initialDays === null ? "" : String(evidence.initialDays));
  }, [current?.retentionDays, current?.pixelId, evidence.initialDays, isCurrentPeriod, pixelId, criterion]);

  const send = async (action: "website-review" | "website-confirm" | "website-reconcile") => {
    setError(null);
    if (action === "website-review" && ((!periodReady && !isCurrentPeriod) || !eventReady)) { setError("Esta combinação está impedida: a fonte ainda não confirmou o evento ou o Gerenciador da Meta ainda não tem evidência fechada do período. Nenhum valor é solicitado às cegas."); return; }
    const days = Number(retentionDays);
    if (!name.trim() || !pixelId || !Number.isInteger(days) || days < 1 || (criterion === "url" && !url.trim()) || (criterion === "event" && !event.trim())) { setError("Informe nome, fonte e o filtro exigido pelo critério; o período só pode ser escolhido quando a evidência do Gerenciador estiver fechada."); return; }
    if (periodReady && evidence.metaMinimumDays !== null && days < evidence.metaMinimumDays) { setError(`O período deve ser de pelo menos ${evidence.metaMinimumDays} dias para esta combinação.`); return; }
    if (periodReady && evidence.metaMaximumDays !== null && days > evidence.metaMaximumDays) { setError(`O período deve ser de no máximo ${evidence.metaMaximumDays} dias para esta combinação.`); return; }
    if (action !== "website-review" && !review) { setError("Faça uma revisão nova antes de confirmar."); return; }
    setSaving(true);
    try {
      const response = await fetch(`/api/meta-marketing/${accountId}/audiences?userId=${encodeURIComponent(userId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, audienceId: audience?.id, name, pixelId, criterion, retentionDays: days, url, event, confirmationToken: review?.confirmationToken, commandId: review?.commandId }) });
      const body = await response.json().catch(() => ({}));
      if (action === "website-review") { if (!response.ok || !body.ok) throw new Error(body.message ?? body.issues?.[0]?.reason ?? "Não foi possível revisar o público."); setReview(body as Review); return; }
      if (!response.ok || !body.ok) { if (body.state === "reconciliation_required") { setError("A resposta foi incerta. Consulte a biblioteca para reconciliar antes de repetir."); return; } throw new Error(body.message ?? body.issues?.[0]?.reason ?? "Não foi possível salvar o público."); }
      setReview(null); onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível salvar o público."); } finally { setSaving(false); }
  };

  if (audience && !current) return null;
  const periodEvidenceReady = (periodReady || isCurrentPeriod) && eventReady;
  const periodBlocker = "O Gerenciador da Meta ainda não comprovou esta combinação de origem e critério. O período inicial, a edição, os limites e o preenchimento histórico permanecem desconhecidos; a criação ou a troca para esta combinação está impedida.";
  return <details className="rounded-lg border bg-card p-4"><summary className="cursor-pointer font-medium">{audience ? "Editar regra do site" : "Criar público do site"}</summary><div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-sm">Nome<input className="mt-1 w-full rounded border bg-background p-2" value={name} onChange={(event) => setName(event.target.value)} /></label><label className="text-sm">Fonte com atividade<select className="mt-1 w-full rounded border bg-background p-2" value={pixelId} onChange={(event) => setPixelId(event.target.value)}>{sources.map((source) => <option key={source.id} value={source.id}>{source.name ?? source.id}</option>)}</select></label><label className="text-sm">Critério<select className="mt-1 w-full rounded border bg-background p-2" value={criterion} onChange={(event) => setCriterion(event.target.value as WebsiteAudienceCriterion)}><option value="visitors">Todos os visitantes registrados</option><option value="url">Páginas por URL</option><option value="event" disabled={!eventsConfirmed}>Eventos registrados{observedEvents.length ? "" : " (aguarda observação da fonte)"}</option></select></label>{periodReady ? <label className="text-sm">Período de participação (dias)<Input className="mt-1 w-full rounded border bg-background p-2" type="number" inputMode="numeric" min={evidence.metaMinimumDays ?? 1} max={evidence.metaMaximumDays ?? undefined} value={retentionDays} onChange={(event) => setRetentionDays(event.target.value)} /></label> : isCurrentPeriod ? <div className="text-sm"><span className="block">Período real do objeto</span><Input aria-label="Período real do objeto" className="mt-1 block w-full rounded border bg-muted/30 p-2" type="number" value={current?.retentionDays ?? ""} readOnly /></div> : <div className="text-sm"><span className="block">Período de participação</span><p className="mt-1 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">Impedido até a evidência do Gerenciador. O formulário não pede um número para descobrir sozinho.</p></div>}{criterion === "url" ? <label className="text-sm md:col-span-2">URL contém<input className="mt-1 w-full rounded border bg-background p-2" value={url} onChange={(event) => setUrl(event.target.value)} /></label> : null}{criterion === "event" ? <label className="text-sm md:col-span-2">Evento observado<select className="mt-1 w-full rounded border bg-background p-2" value={event} onChange={(input) => setEvent(input.target.value)}><option value="">Selecione um evento confirmado</option>{observedEvents.map((value) => <option key={value} value={value}>{value}</option>)}{event && !observedEvents.includes(event) ? <option value={event} disabled>{event} (não confirmado)</option> : null}</select></label> : null}</div><p className="mt-3 text-xs text-muted-foreground">Fonte, atividade e disponibilidade são fatos distintos. O período é uma janela móvel e só recebe o valor inicial da evidência fechada para esta origem e critério; ele não é inventado nem truncado.</p><dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-muted-foreground md:grid-cols-2"><div><dt className="inline font-medium">Valor inicial:</dt>{" "}<dd className="inline">{evidence.initialDays === null ? "não comprovado" : `${evidence.initialDays} dias`}</dd></div><div><dt className="inline font-medium">Editável:</dt>{" "}<dd className="inline">{evidence.editable === "unknown" ? "não comprovado" : evidence.editable === "yes" ? "sim" : "não"}</dd></div><div><dt className="inline font-medium">Limites Meta:</dt>{" "}<dd className="inline">{evidence.metaMinimumDays === null && evidence.metaMaximumDays === null ? "não comprovados" : `${evidence.metaMinimumDays ?? "sem mínimo"}–${evidence.metaMaximumDays ?? "sem máximo"} dias`}</dd></div><div><dt className="inline font-medium">Limite local:</dt>{" "}<dd className="inline">{evidence.localValidationMaximumDays === null ? "não imposto" : `${evidence.localValidationMaximumDays} dias`}</dd></div><div><dt className="inline font-medium">Unidade enviada:</dt>{" "}<dd className="inline">{evidence.unit} (retention_seconds)</dd></div><div><dt className="inline font-medium">Preenchimento histórico:</dt>{" "}<dd className="inline">{stateLabel(evidence.historicalFill)}</dd></div></dl>{!periodReady && !isCurrentPeriod ? <p role="alert" className="mt-2 text-sm text-amber-700">{periodBlocker} Evidência registrada em {evidence.observedAt}; origem: {evidence.source}</p> : null}{isCurrentPeriod && !periodReady ? <p role="status" className="mt-2 text-sm text-muted-foreground">O período real de {current?.retentionDays} dias foi carregado do objeto e será preservado. A alteração de origem ou critério exige evidência própria e não reutiliza este valor.</p> : null}{criterion === "event" && !eventsConfirmed ? <p role="alert" className="mt-2 text-sm text-amber-700">Eventos registrados estão impedidos porque nenhum evento positivo foi observado nos stats WEB_ONLY deste Pixel. A fonte precisa registrar o evento; nenhum catálogo genérico libera esta opção.</p> : null}{selectedSource?.source ? <p className="mt-2 text-xs text-muted-foreground">Fonte: {stateLabel(selectedSource.source.access)} · atividade: {stateLabel(selectedSource.source.activity)} · disponibilidade: {stateLabel(selectedSource.source.availability)}</p> : null}{guidance ? <p role="status" className="mt-3 text-sm text-muted-foreground">{guidance}</p> : null}{review ? <div className="mt-4 space-y-2 rounded border bg-muted/20 p-3 text-sm"><p className="font-medium">Revisão pronta para confirmação</p><p>Antes: {review.before ? `${review.before.criterion}, ${review.before.retentionDays} dias` : "público inexistente"} · depois: {review.after.criterion}, {review.after.retentionDays} dias.</p><p>Fonte: {stateLabel(review.source.access)} · atividade: {stateLabel(review.source.activity)} · disponibilidade: {stateLabel(review.source.availability)}.</p><p>{review.notice}</p><p className="text-xs text-muted-foreground">Período inicial: {review.periodEvidence.initialDays ?? "não registrado"}; limite Meta específico: {review.periodEvidence.metaMaximumDays ?? "não confirmado"}; preenchimento histórico: {stateLabel(review.periodEvidence.historicalFill)}.</p>{review.impact.knownUses.length ? <p className="text-xs text-muted-foreground">Usos conhecidos: {review.impact.knownUses.map((use) => `${use.adSetName ?? use.adSetId} (${use.placement})`).join(", ")}</p> : null}{review.impact.limitations.map((limitation) => <p key={limitation} className="text-xs text-muted-foreground">{limitation}</p>)}<div className="flex flex-wrap gap-2"><Button type="button" onClick={() => void send("website-confirm")} disabled={saving}>{saving ? "Salvando..." : "Confirmar"}</Button><Button type="button" variant="outline" onClick={() => void send("website-review")} disabled={saving || !periodEvidenceReady}>Revisar novamente</Button></div></div> : <Button type="button" className="mt-4" onClick={() => void send("website-review")} disabled={saving || !sources.length || !periodEvidenceReady}>{saving ? "Revisando..." : "Revisar"}</Button>}{error ? <div className="mt-3 space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p>{review ? <Button type="button" variant="outline" onClick={() => void send("website-reconcile")} disabled={saving}>Reconciliar resultado</Button> : null}</div> : null}</details>;
}
