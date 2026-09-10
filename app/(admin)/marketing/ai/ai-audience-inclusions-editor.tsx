"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { CustomAudienceView } from "@/lib/meta-business/marketing/audiences/types";
import type { AudienceInclusionIds } from "@/lib/meta-business/marketing/ai-creation/audience-inclusions";

type LibraryResponse = {
  audiences: CustomAudienceView[];
  hasNextPage?: boolean;
  nextCursor?: string;
};

function estimate(audience: CustomAudienceView): string {
  const lower = audience.approximateCountLowerBound;
  const upper = audience.approximateCountUpperBound;
  if (lower === undefined && upper === undefined) return "tamanho nÃ£o informado";
  const format = new Intl.NumberFormat("pt-BR");
  return lower !== undefined && upper !== undefined
    ? format.format(lower) + "â€“" + format.format(upper)
    : format.format(lower ?? upper ?? 0);
}

function availabilityMessage(audience: CustomAudienceView): string | null {
  if (audience.availability?.include === "blocked") {
    return "Bloqueado por integridade; corrija/reconcilie ou troque o pÃºblico.";
  }
  if (audience.capabilities.include === "unavailable") {
    return "PermissÃ£o de inclusÃ£o indisponÃ­vel; atualize/reautorize ou troque o pÃºblico.";
  }
  if (
    audience.availability?.metaProcessing === "processing" ||
    audience.availability?.metaProcessing === "unknown"
  ) {
    return "Processamento/tamanho nÃ£o confirmado; isso nÃ£o bloqueia a seleÃ§Ã£o por si sÃ³.";
  }
  if (audience.capabilities.include === "unknown") {
    return "PermissÃ£o serÃ¡ revalidada antes da publicaÃ§Ã£o.";
  }
  return null;
}

export function AiAudienceInclusionsEditor({
  accountId,
  userId,
  value,
  onChange,
  disabled,
}: {
  accountId: string;
  userId: string;
  value: AudienceInclusionIds | undefined;
  onChange: (value: AudienceInclusionIds | undefined) => void;
  disabled?: boolean;
}) {
  const [audiences, setAudiences] = useState<CustomAudienceView[]>([]);
  const [draftIds, setDraftIds] = useState<AudienceInclusionIds>(value ? [...value] : []);
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

    void (async () => {
      const all: CustomAudienceView[] = [];
      let after: string | undefined;
      for (let page = 0; page < 20; page += 1) {
        const query = new URLSearchParams({ userId, detailed: "1" });
        if (after) query.set("after", after);
        const response = await fetch("/api/meta-marketing/" + accountId + "/audiences?" + query);
        const body = (await response.json().catch(() => ({}))) as LibraryResponse & {
          message?: string;
        };
        if (!response.ok) {
          throw new Error(body.message ?? "NÃ£o foi possÃ­vel carregar os pÃºblicos.");
        }
        all.push(...(body.audiences ?? []));
        if (!body.hasNextPage) break;
        if (!body.nextCursor) {
          throw new Error("Nao foi possivel carregar a biblioteca completa de publicos.");
        }
        if (page === 19) {
          throw new Error("Nao foi possivel carregar a biblioteca completa de publicos.");
        }
        after = body.nextCursor;
      }
      if (active) setAudiences(all);
    })()
      .catch((caught) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "NÃ£o foi possÃ­vel carregar os pÃºblicos.",
          );
        }
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

  const toggle = (id: string, checked: boolean) => {
    setDraftIds((current) =>
      checked
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((currentId) => currentId !== id),
    );
  };

  return (
    <section
      className="space-y-3 rounded-lg border p-4"
      aria-labelledby="ai-audience-inclusions-title"
    >
      <div>
        <h2 id="ai-audience-inclusions-title" className="text-sm font-medium">
          InclusÃµes de pÃºblicos
        </h2>
        <p className="text-sm text-muted-foreground">
          Inclua pÃºblicos personalizados ou lookalikes. Eles se combinam por OU e restringem a
          entrega; a expansÃ£o fica desativada.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando pÃºblicosâ€¦
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
              audience.availability?.include === "blocked" ||
              audience.capabilities.include === "unavailable";
            const guidance = availabilityMessage(audience);
            const checkboxId = "include-" + audience.id;
            return (
              <div
                key={audience.id}
                className="flex min-h-11 items-start gap-3 rounded-md border p-3"
              >
                <Switch
                  aria-label={"Incluir " + (audience.name ?? audience.id)}
                  checked={draftIds.includes(audience.id)}
                  className="mt-0.5 h-11 w-11 shrink-0"
                  disabled={disabled || unavailable}
                  onCheckedChange={(checked) => toggle(audience.id, checked)}
                  id={checkboxId}
                />
                <div className="min-w-0 space-y-1">
                  <Label className="cursor-pointer" htmlFor={checkboxId}>
                    {audience.name ?? "Sem nome"}
                  </Label>
                  <p className="font-mono text-xs text-muted-foreground">{audience.id}</p>
                  <p className="text-xs text-muted-foreground">
                    {audience.subtype ?? "Tipo nÃ£o informado"} Â· {estimate(audience)}
                  </p>
                  {guidance ? (
                    <p
                      className={
                        unavailable ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                      }
                    >
                      {guidance}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
          {missingIds.length ? (
            <p className="text-xs text-destructive" role="alert">
              {missingIds.length} inclusÃ£o(Ãµes) aplicada(s) nÃ£o estÃ¡(Ã£o) mais acessÃ­vel(is).
              Atualize a biblioteca antes de publicar.
            </p>
          ) : null}
          {audiences.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum pÃºblico acessÃ­vel nesta conta.
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {value === undefined
          ? "Estado atual: inclusÃµes herdadas do molde/base."
          : "Estado atual: " + value.length + " inclusÃ£o(Ãµes) aplicada(s)."}
        {draftIds.length !== (value?.length ?? 0) ? " Rascunho: " + draftIds.length + "." : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={disabled || loading || Boolean(error)}
          onClick={() => onChange([...draftIds])}
          type="button"
        >
          Aplicar inclusÃµes
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
