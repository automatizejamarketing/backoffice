"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CustomerFileImportStatus } from "@/lib/customer-file/import-service";
import type { CustomAudienceView } from "@/lib/meta-business/marketing/audiences/types";
import { AudienceDeletionControl } from "./audience-deletion-control";
import { AudienceMetadataEditor } from "./audience-metadata-editor";
import { CustomerListImport } from "./customer-list-import";
import { InstagramAudienceEditor } from "./instagram-audience-editor";
import { LookalikeAudienceCreator } from "./lookalike-audience-creator";
import { WebsiteAudienceEditor } from "./website-audience-editor";

type LibraryResponse = {
  audiences: CustomAudienceView[];
  hasNextPage: boolean;
  nextCursor?: string;
  queriedAt: string;
  limitations: string[];
};

function statusText(status: { code?: number; description?: string } | undefined) {
  if (!status) return "Não informado";
  return [status.code, status.description].filter(Boolean).join(" — ");
}

function estimateText(audience: CustomAudienceView) {
  const { approximateCountLowerBound: lower, approximateCountUpperBound: upper } = audience;
  if (lower === undefined && upper === undefined) return "Estimativa indisponível";
  const format = new Intl.NumberFormat("pt-BR");
  if (lower !== undefined && upper !== undefined) return `${format.format(lower)}–${format.format(upper)}`;
  return format.format(lower ?? upper ?? 0);
}

function ruleText(audience: CustomAudienceView) {
  if (audience.ruleSummary === "external") return "Regra externa";
  if (audience.ruleSummary === "not_loaded") return "Regra não carregada";
  return "Sem regra representável";
}

const capabilityLabels: Record<keyof CustomAudienceView["capabilities"], string> = {
  read: "Consulta",
  include: "Incluir",
  exclude: "Excluir",
  editMetadata: "Editar metadados",
  share: "Compartilhar",
  editRule: "Editar regra",
  manageMembers: "Alterar membros",
  delete: "Excluir objeto",
  lookalikeSource: "Origem de lookalike",
};

function capabilityText(audience: CustomAudienceView) {
  return (Object.keys(capabilityLabels) as Array<keyof CustomAudienceView["capabilities"]>)
    .map((capability) => {
      const state = audience.capabilities[capability];
      const label = state === "available" ? "disponível" : state === "unavailable" ? "indisponível" : "não confirmada";
      return `${capabilityLabels[capability]}: ${label}`;
    })
    .join("; ");
}

function availabilityText(value: "available" | "blocked" | "unknown") {
  if (value === "available") return "disponível";
  if (value === "blocked") return "bloqueada";
  return "desconhecida";
}

function importResultText(audience: CustomAudienceView) {
  const result = audience.importResult;
  if (!result) return null;
  if (!result.known) return "Importação local: sem histórico";
  return `Importação local: ${result.state}${result.pendingUnresolved ? " (pendência não resolvida)" : ""}`;
}

function getImportStatusDisplay(imports: CustomerFileImportStatus[], audienceId: string) {
  const latest = imports.find((operation) => operation.audienceId === audienceId);
  if (!latest) return null;
  return {
    text: `Importação: ${latest.label}${latest.pendingUnresolved ? " — pendência não resolvida" : ""}`,
    pending: latest.pendingUnresolved,
  };
}

/**
 * The account-scoped audience manager shared by the standalone library and
 * the AI campaign dialog. It intentionally has no campaign-selection
 * callback: managing an audience never applies it to a campaign. Entry points
 * key it by client and account so changing either boundary remounts the manager.
 */
export function AudienceLibraryManager({ accountId, userId }: { accountId: string; userId: string }) {
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const [imports, setImports] = useState<CustomerFileImportStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const after = cursors.at(-1);
    const query = new URLSearchParams({ detailed: "1", userId });
    if (after) query.set("after", after);

    void Promise.resolve()
      .then(() => {
        if (!active) return null;
        setLoading(true);
        setError(null);
        return fetch(`/api/meta-marketing/${accountId}/audiences?${query.toString()}`);
      })
      .then(async (response) => {
        if (!response) return null;
        const body = (await response.json().catch(() => ({}))) as LibraryResponse & { message?: string };
        if (!response.ok) throw new Error(body.message ?? "Não foi possível consultar os públicos.");
        return body;
      })
      .then((body) => {
        if (active && body) setLibrary(body);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Não foi possível consultar os públicos.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [accountId, cursors, userId, refreshKey]);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ userId });
    void fetch(`/api/meta-marketing/${accountId}/audiences/customer-file?${query.toString()}`)
      .then(async (response) => {
        if (!response.ok) return [];
        const body = (await response.json()) as { operations?: CustomerFileImportStatus[] };
        return body.operations ?? [];
      })
      .then((operations) => {
        if (active) setImports(operations);
      })
      .catch(() => {
        // Import status is supplementary to the library. The import surface
        // shows its own authorization/availability error when opened.
      });

    return () => {
      active = false;
    };
  }, [accountId, refreshKey, userId]);

  const refresh = () => setRefreshKey((current) => current + 1);

  return (
    <section className="space-y-6" aria-label="Gerenciador de públicos">
      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />{error}
        </div>
      ) : null}

      {loading ? <div className="flex justify-center p-8"><Loader2 className="size-6 animate-spin" aria-label="Carregando públicos" /></div> : null}

      {library ? (
        <>
          <CustomerListImport
            key={`${userId}:${accountId}`}
            accountId={accountId}
            userId={userId}
            audiences={library.audiences}
            onChanged={refresh}
          />
          <InstagramAudienceEditor accountId={accountId} userId={userId} onSaved={refresh} />
          <WebsiteAudienceEditor accountId={accountId} userId={userId} onSaved={refresh} />
          <LookalikeAudienceCreator accountId={accountId} userId={userId} audiences={library.audiences} onSaved={refresh} />

          <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="hidden grid-cols-[minmax(12rem,1.5fr)_repeat(4,minmax(8rem,1fr))] gap-4 border-b bg-muted/30 px-5 py-3 text-xs font-medium text-muted-foreground md:grid">
              <span>Identidade e origem</span><span>Regra e período</span><span>Processamento Meta</span><span>Entrega Meta e funções</span><span>Estimativa e importação</span>
            </div>
            <ul className="divide-y">
              {library.audiences.map((audience) => {
                const importState = getImportStatusDisplay(imports, audience.id);
                const importResult = importResultText(audience);
                return (
                  <li key={audience.id} className="grid gap-3 px-5 py-4 text-sm md:grid-cols-[minmax(12rem,1.5fr)_repeat(4,minmax(8rem,1fr))] md:gap-4">
                    <div>
                      <p className="font-medium">{audience.name ?? "Sem nome"}</p>
                      <p className="font-mono text-xs text-muted-foreground">{audience.id}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{audience.subtype ?? "Tipo não informado"}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {audience.capabilities.editMetadata === "available" ? <AudienceMetadataEditor audience={audience} accountId={accountId} userId={userId} onSaved={refresh} /> : null}
                        <AudienceDeletionControl audience={audience} accountId={accountId} userId={userId} onDeleted={refresh} />
                      </div>
                      <div className="mt-2">
                        <InstagramAudienceEditor accountId={accountId} userId={userId} audience={audience} onSaved={refresh} />
                        <WebsiteAudienceEditor accountId={accountId} userId={userId} audience={audience} onSaved={refresh} />
                      </div>
                    </div>
                    <div>
                      <p>{ruleText(audience)}</p>
                      {audience.retentionDays !== undefined ? <p className="mt-1 text-xs text-muted-foreground">Período: {audience.retentionDays} dias</p> : null}
                    </div>
                    <div><p>{statusText(audience.operationStatus)}</p></div>
                    <div>
                      <p>Entrega: {statusText(audience.deliveryStatus)}</p>
                      {audience.availability ? <p className="mt-1 text-xs text-muted-foreground">Incluir: {availabilityText(audience.availability.include)} · Excluir: {availabilityText(audience.availability.exclude)} · Lookalike: {availabilityText(audience.availability.lookalikeSource)}</p> : null}
                    </div>
                    <div>
                      <p>{estimateText(audience)}</p>
                      {importResult ? <p className={audience.availability?.lookalikeSource === "blocked" ? "mt-1 text-xs text-destructive" : "mt-1 text-xs text-muted-foreground"}>{importResult}</p> : null}
                      {importState ? <p className={`mt-2 text-xs ${importState.pending ? "text-destructive" : "text-muted-foreground"}`}>{importState.text}</p> : null}
                      <p className="mt-1 text-xs text-muted-foreground">{capabilityText(audience)}</p>
                      {audience.originAudienceId ? <p className="mt-1 font-mono text-xs text-muted-foreground">Origem: {audience.originAudienceId}</p> : null}
                    </div>
                  </li>
                );
              })}
              {library.audiences.length === 0 ? <li className="px-5 py-10 text-center text-sm text-muted-foreground">Nenhum público acessível nesta página.</li> : null}
            </ul>
          </div>

          <div className="flex items-center justify-between gap-4">
            <Button variant="outline" disabled={cursors.length === 0} onClick={() => setCursors((current) => current.slice(0, -1))}><ChevronLeft />Anterior</Button>
            <span className="text-xs text-muted-foreground">Página {cursors.length + 1} · consulta em {new Date(library.queriedAt).toLocaleString("pt-BR")}</span>
            <Button variant="outline" disabled={!library.hasNextPage || !library.nextCursor} onClick={() => library.nextCursor && setCursors((current) => [...current, library.nextCursor!])}>Próxima<ChevronRight /></Button>
          </div>

          <aside className="rounded-lg border bg-muted/20 p-4 text-xs text-muted-foreground" aria-label="Limitações da consulta">
            {library.limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}
          </aside>
        </>
      ) : null}
    </section>
  );
}
