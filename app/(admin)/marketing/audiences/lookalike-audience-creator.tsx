"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { assessLookalikeSource } from "@/lib/meta-business/marketing/audiences/lookalike";
import type { CustomAudienceView } from "@/lib/meta-business/marketing/audiences/types";

type Review = {
  confirmationToken: string;
  source: { id: string; name?: string; subtype?: string };
  formation: { country: string; percentage: number };
  notice: string;
};

type Action = "lookalike-review" | "lookalike-confirm" | "lookalike-reconcile";

export function LookalikeAudienceCreator({
  accountId,
  userId,
  audiences,
  onSaved,
}: {
  accountId: string;
  userId: string;
  audiences: CustomAudienceView[];
  onSaved: () => void;
}) {
  const { sources, blockedSources } = useMemo(() => {
    const evaluated = audiences.map((audience) => ({ audience, result: assessLookalikeSource(audience) }));
    return {
      sources: evaluated.filter(({ result }) => result.ok).map(({ audience }) => audience),
      blockedSources: evaluated.flatMap(({ audience, result }) => result.ok ? [] : [{ audience, message: result.message }]),
    };
  }, [audiences]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [originAudienceId, setOriginAudienceId] = useState("");
  const [country, setCountry] = useState("BR");
  const [percentage, setPercentage] = useState("1");
  const [review, setReview] = useState<Review | null>(null);
  const [reconciliationRequired, setReconciliationRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const payload = () => ({
    originAudienceId,
    name,
    description: description || undefined,
    country,
    percentage: Number(percentage),
  });

  const resetAfterSuccess = () => {
    setReview(null);
    setReconciliationRequired(false);
    setName("");
    setDescription("");
    setOriginAudienceId("");
    onSaved();
  };

  const request = async (action: Action) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/meta-marketing/${accountId}/audiences?userId=${encodeURIComponent(userId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload(), ...(review ? { confirmationToken: review.confirmationToken, commandId: review.confirmationToken } : {}) }),
      });
      const body = await response.json().catch(() => ({})) as Review & { ok?: boolean; message?: string; state?: string };
      if (!response.ok || !body.ok) {
        if (body.state === "reconciliation_required") setReconciliationRequired(true);
        throw new Error(body.message ?? "Não foi possível criar o público semelhante.");
      }
      if (action === "lookalike-review") {
        setReview(body);
        setReconciliationRequired(false);
      } else {
        resetAfterSuccess();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível criar o público semelhante.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">Criar público semelhante</summary>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label>Nome<input className="mt-1 w-full rounded border p-2" value={name} onChange={(event) => { setName(event.target.value); setReview(null); setReconciliationRequired(false); }} /></label>
        <label>Descrição (opcional)<input className="mt-1 w-full rounded border p-2" value={description} onChange={(event) => { setDescription(event.target.value); setReview(null); setReconciliationRequired(false); }} /></label>
        <label>Origem elegível<select className="mt-1 w-full rounded border p-2" value={originAudienceId} onChange={(event) => { setOriginAudienceId(event.target.value); setReview(null); setReconciliationRequired(false); }}><option value="">Selecione</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name ?? source.id}</option>)}</select></label>
        <label>País (ISO-2)<input className="mt-1 w-full rounded border p-2" value={country} onChange={(event) => { setCountry(event.target.value); setReview(null); setReconciliationRequired(false); }} /></label>
        <label>Tamanho do semelhante (%)<input className="mt-1 w-full rounded border p-2" inputMode="numeric" value={percentage} onChange={(event) => { setPercentage(event.target.value); setReview(null); setReconciliationRequired(false); }} /></label>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Brasil e 1% são valores iniciais. O percentual define o tamanho do público semelhante, não a confiança ou a taxa de correspondência. A Meta decide a elegibilidade final.</p>
      {blockedSources.length ? <div className="mt-3 rounded border border-amber-300 p-3 text-xs text-amber-900"><p className="font-medium">Origens bloqueadas:</p>{blockedSources.map(({ audience, message }) => <p key={audience.id} className="mt-1">{audience.name ?? audience.id}: {message}</p>)}<p className="mt-2">Ação: corrija a importação comprometida ou escolha uma origem elegível.</p></div> : null}
      {review ? <div className="mt-3 rounded border p-3 text-sm"><p>Revise: {review.source.name ?? review.source.id} · {review.formation.country} · {review.formation.percentage}%.</p><p className="mt-1 text-xs text-muted-foreground">{review.notice}</p><div className="mt-3 flex flex-wrap gap-2"><Button disabled={saving} onClick={() => void request("lookalike-confirm")}>{saving ? "Criando..." : "Confirmar criação"}</Button>{reconciliationRequired ? <Button variant="outline" disabled={saving} onClick={() => void request("lookalike-reconcile")}>Reconciliar resultado</Button> : null}</div></div> : <Button className="mt-3" disabled={saving || !sources.length} onClick={() => void request("lookalike-review")}>{saving ? "Revisando..." : "Revisar criação"}</Button>}
      {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
      {!sources.length ? <p className="mt-2 text-sm text-muted-foreground">Nenhuma origem elegível acessível nesta página.</p> : null}
    </details>
  );
}
