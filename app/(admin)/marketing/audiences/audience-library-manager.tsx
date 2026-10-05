"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CustomAudienceView } from "@/lib/meta-business/marketing/audiences/types";
import type { CustomerFileImportStatus } from "@/lib/customer-file/import-service";
import {
  audienceEstimateLabel,
  audienceStatusLabel,
  audienceTypeLabel,
  resolveAudienceEditKind,
} from "./audience-kind";
import { AudienceDeletionControl } from "./audience-deletion-control";
import { AudienceWorkspace, type AudienceWorkspaceState } from "./audience-workspace";

type LibraryResponse = {
  audiences: CustomAudienceView[];
  hasNextPage: boolean;
  nextCursor?: string;
  queriedAt: string;
  limitations: string[];
};

/**
 * The account-scoped audience manager shared by the standalone library and
 * the AI campaign dialog. It intentionally has no campaign-selection
 * callback: managing an audience never applies it to a campaign.
 */
type ManagerProps = { accountId: string; userId: string; surface?: "page" | "embedded" };

export function AudienceLibraryManager(props: ManagerProps) {
  return <AudienceLibrary key={`${props.userId}:${props.accountId}`} {...props} />;
}

function AudienceLibrary({
  accountId,
  userId,
  surface = "page",
}: {
  accountId: string;
  userId: string;
  surface?: "page" | "embedded";
}) {
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const [imports, setImports] = useState<CustomerFileImportStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [workspace, setWorkspace] = useState<AudienceWorkspaceState | null>(null);

  const pageTransition = useRef(false);

  useEffect(() => {
    let active = true;
    const after = cursors.at(-1);
    const query = new URLSearchParams({ detailed: "1", userId });
    if (after) query.set("after", after);

    pageTransition.current = true;
    setLoading(true);
    setLibrary(null);
    setWorkspace(null);
    setError(null);
    void fetch(`/api/meta-marketing/${accountId}/audiences?${query.toString()}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as LibraryResponse & { message?: string };
        if (!response.ok) throw new Error(body.message ?? "Não foi possível consultar os públicos.");
        return body;
      })
      .then((body) => {
        if (active) setLibrary(body);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Não foi possível consultar os públicos.");
      })
      .finally(() => {
        if (active) { pageTransition.current = false; setLoading(false); }
      });

    return () => {
      active = false;
    };
  }, [accountId, userId, cursors, refreshKey]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/meta-marketing/${accountId}/audiences/customer-file?${new URLSearchParams({ userId })}`)
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
  }, [accountId, userId, refreshKey]);

  const beginTransition = () => {
    pageTransition.current = true;
    setLoading(true);
    setLibrary(null);
    setWorkspace(null);
  };
  const refresh = () => { beginTransition(); setRefreshKey((current) => current + 1); };
  const closeWorkspace = () => setWorkspace(null);
  const showLibrary = surface === "page" || workspace === null;

  return (
    <section className="@container min-w-0 space-y-4" aria-label="Gerenciador de públicos">
      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {showLibrary ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {library
              ? `${library.audiences.length} público${library.audiences.length === 1 ? "" : "s"} nesta página`
              : "Biblioteca da conta"}
          </p>
          <Button disabled={loading || !library} onClick={(event) => { event.currentTarget.focus(); setWorkspace({ view: "create-type" }); }} type="button">
            <Plus />
            Criar público
          </Button>
        </div>
      ) : null}

      {loading && showLibrary ? (
        <div className="flex justify-center p-8">
          <Loader2 className="size-6 animate-spin" aria-label="Carregando públicos" />
        </div>
      ) : null}

      {library && showLibrary ? (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="hidden grid-cols-[minmax(12rem,2fr)_minmax(8rem,1fr)_minmax(7rem,1fr)_minmax(8rem,1fr)_auto] gap-4 border-b border-border bg-muted/30 px-4 py-2.5 text-xs font-medium text-muted-foreground @min-[52rem]:grid">
              <span>Nome</span>
              <span>Tipo</span>
              <span>Tamanho</span>
              <span>Status</span>
              <span className="sr-only">Ações</span>
            </div>
            <ul className="divide-y divide-border">
              {library.audiences.map((audience) => {
                const importState = imports.find((operation) => operation.audienceId === audience.id);
                return (
                  <li
                    className="grid items-center gap-2 px-4 py-3 text-sm @min-[52rem]:grid-cols-[minmax(12rem,2fr)_minmax(8rem,1fr)_minmax(7rem,1fr)_minmax(8rem,1fr)_auto] @min-[52rem]:gap-4"
                    key={audience.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{audience.name ?? "Sem nome"}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground @min-[52rem]:hidden">
                        {audienceTypeLabel(audience)} · {audienceEstimateLabel(audience)}
                      </p>
                      {importState?.pendingUnresolved ? (
                        <p className="mt-1 text-xs text-destructive">Importação com pendência</p>
                      ) : null}
                    </div>
                    <p className="hidden text-muted-foreground @min-[52rem]:block">{audienceTypeLabel(audience)}</p>
                    <p className="hidden tabular-nums text-muted-foreground @min-[52rem]:block">{audienceEstimateLabel(audience)}</p>
                    <p className="hidden truncate text-muted-foreground @min-[52rem]:block">{audienceStatusLabel(audience)}</p>
                    <p className="text-muted-foreground @min-[52rem]:hidden">{audienceStatusLabel(audience)}</p>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        disabled={resolveAudienceEditKind(audience) === "metadata" && audience.capabilities.editMetadata !== "available"}
                        onClick={(event) => {
                          event.currentTarget.focus();
                          setWorkspace({
                            view: "edit",
                            audience,
                            kind: resolveAudienceEditKind(audience),
                          });
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Pencil />
                        Editar
                      </Button>
                      <AudienceDeletionControl
                        audience={audience}
                        accountId={accountId} userId={userId}
                        onDeleted={refresh}
                      />
                    </div>
                  </li>
                );
              })}
              {library.audiences.length === 0 ? (
                <li className="px-4 py-12 text-center text-sm text-muted-foreground">
                  Nenhum público nesta página. Crie o primeiro a partir da origem que você já usa.
                </li>
              ) : null}
            </ul>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              disabled={loading || cursors.length === 0}
              onClick={() => { if (pageTransition.current) return; beginTransition(); setCursors((current) => current.slice(0, -1)); }}
              variant="outline"
            >
              <ChevronLeft />
              Anterior
            </Button>
            <span className="min-w-0 text-xs text-muted-foreground">
              Página {cursors.length + 1} · consulta em {new Date(library.queriedAt).toLocaleString("pt-BR")}
              {library.limitations.length ? ` · ${library.limitations.length} limitação(ões) da consulta` : ""}
            </span>
            <Button
              disabled={loading || !library.hasNextPage || !library.nextCursor}
              onClick={() => { if (pageTransition.current || !library.nextCursor) return; const cursor = library.nextCursor; beginTransition(); setCursors((current) => [...current, cursor]); }}
              variant="outline"
            >
              Próxima
              <ChevronRight />
            </Button>
          </div>
          {library.limitations.length ? <aside aria-label="Limitações da consulta" className="text-xs text-muted-foreground">{library.limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}</aside> : null}
        </>
      ) : null}

      {library ? (
        <AudienceWorkspace
          accountId={accountId}
          userId={userId}
          audiences={library.audiences}
          onBackToTypes={() => setWorkspace({ view: "create-type" })}
          onClose={closeWorkspace}
          onSaved={() => {
            refresh();
            closeWorkspace();
          }}
          onSelectKind={(kind) => setWorkspace({ view: "create", kind })}
          state={workspace}
          surface={surface === "embedded" ? "inline" : "dialog"}
        />
      ) : null}
    </section>
  );
}
