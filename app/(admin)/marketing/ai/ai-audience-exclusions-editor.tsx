"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { CustomAudienceView } from "@/lib/meta-business/marketing/audiences/types";
import type { AudienceExclusionIds } from "@/lib/meta-business/marketing/ai-creation/audience-exclusions";

type LibraryResponse = {
  audiences: CustomAudienceView[];
};

function estimate(audience: CustomAudienceView): string {
  const lower = audience.approximateCountLowerBound;
  const upper = audience.approximateCountUpperBound;
  if (lower === undefined && upper === undefined) return "tamanho não informado";
  const format = new Intl.NumberFormat("pt-BR");
  return lower !== undefined && upper !== undefined
    ? format.format(lower) + "–" + format.format(upper)
    : format.format(lower ?? upper ?? 0);
}

function availabilityMessage(audience: CustomAudienceView): string | null {
  if (audience.availability?.exclude === "blocked") {
    return "Bloqueado por integridade; corrija/reconcilie ou troque o público.";
  }
  if (audience.capabilities.exclude === "unavailable") {
    return "Permissão de exclusão indisponível; atualize/reautorize ou troque o público.";
  }
  if (
    audience.availability?.metaProcessing === "processing" ||
    audience.availability?.metaProcessing === "unknown"
  ) {
    return "Processamento/tamanho não confirmado; isso não bloqueia a seleção por si só.";
  }
  if (audience.capabilities.exclude === "unknown") {
    return "Permissão será revalidada antes da publicação.";
  }
  return null;
}

export function AiAudienceExclusionsEditor({
  accountId,
  userId,
  value,
  onChange,
  disabled,
}: {
  accountId: string;
  userId: string;
  value: AudienceExclusionIds | undefined;
  onChange: (value: AudienceExclusionIds | undefined) => void;
  disabled?: boolean;
}) {
  const [audiences, setAudiences] = useState<CustomAudienceView[]>([]);
  const [draftIds, setDraftIds] = useState<AudienceExclusionIds>(value ? [...value] : []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftIds(value ? [...value] : []);
  }, [value]);

  useEffect(() => {
    if (!accountId || !userId) return;
    let active = true;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ userId, detailed: "1" });
    void fetch("/api/meta-marketing/" + accountId + "/audiences?" + query)
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as LibraryResponse & { message?: string };
        if (!response.ok) throw new Error(body.message ?? "Não foi possível carregar os públicos.");
        return body;
      })
      .then((body) => {
        if (active) setAudiences(body.audiences ?? []);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Não foi possível carregar os públicos.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountId, userId]);

  const missingIds = useMemo(() => {
    const listed = new Set(audiences.map((audience) => audience.id));
    return (value ?? []).filter((id) => !listed.has(id));
  }, [audiences, value]);

  const toggle = (id: string, checked: boolean | "indeterminate") => {
    if (checked === true) {
      setDraftIds((current) => (current.includes(id) ? current : [...current, id]));
    } else {
      setDraftIds((current) => current.filter((currentId) => currentId !== id));
    }
  };

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="ai-audience-exclusions-title">
      <div>
        <h2 id="ai-audience-exclusions-title" className="text-sm font-medium">
          Exclusões de públicos
        </h2>
        <p className="text-sm text-muted-foreground">
          Escolha quem não deve receber a campanha. Sem aplicar, a configuração atual é mantida.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando públicos…
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start gap-2 text-sm text-destructive" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="space-y-2">
          {audiences.map((audience) => {
            const unavailable =
              audience.availability?.exclude === "blocked" ||
              audience.capabilities.exclude === "unavailable";
            const guidance = availabilityMessage(audience);
            const checkboxId = "exclude-" + audience.id;
            return (
              <div key={audience.id} className="flex items-start gap-3 rounded-md border p-3">
                <input
                  aria-label={"Excluir " + (audience.name ?? audience.id)}
                  checked={draftIds.includes(audience.id)}
                  className="mt-1 size-4 shrink-0 accent-primary"
                  disabled={disabled || unavailable}
                  onChange={(event) => toggle(audience.id, event.target.checked)}
                  id={checkboxId}
                  type="checkbox"
                />
                <div className="min-w-0 space-y-1">
                  <Label className="cursor-pointer" htmlFor={checkboxId}>
                    {audience.name ?? "Sem nome"}
                  </Label>
                  <p className="font-mono text-xs text-muted-foreground">{audience.id}</p>
                  <p className="text-xs text-muted-foreground">
                    {audience.subtype ?? "Tipo não informado"} · {estimate(audience)}
                  </p>
                  {guidance ? (
                    <p className={unavailable ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                      {guidance}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
          {missingIds.length ? (
            <p className="text-xs text-destructive" role="alert">
              {missingIds.length} exclusão(ões) aplicada(s) não está(ão) mais nesta página. Atualize a biblioteca antes de publicar.
            </p>
          ) : null}
          {audiences.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum público acessível nesta conta.</p>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {value === undefined
          ? "Estado atual: exclusões herdadas do molde."
          : "Estado atual: " + value.length + " exclusão(ões) aplicada(s)."}
        {draftIds.length !== (value?.length ?? 0) ? " Rascunho: " + draftIds.length + "." : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={disabled || loading || Boolean(error)}
          onClick={() => onChange([...draftIds])}
          type="button"
        >
          Aplicar exclusões
        </Button>
        <Button
          disabled={disabled}
          onClick={() => setDraftIds(value ? [...value] : [])}
          type="button"
          variant="outline"
        >
          Cancelar
        </Button>
        <Button
          disabled={disabled}
          onClick={() => {
            setDraftIds([]);
            onChange([]);
          }}
          type="button"
          variant="outline"
        >
          Limpar lista
        </Button>
        <Button
          disabled={disabled}
          onClick={() => {
            setDraftIds([]);
            onChange(undefined);
          }}
          type="button"
          variant="ghost"
        >
          Restaurar herdadas
        </Button>
      </div>
    </section>
  );
}
