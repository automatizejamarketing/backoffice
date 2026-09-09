"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CustomAudienceView } from "@/lib/meta-business/marketing/audiences/types";
import { AudienceDeletionControl } from "../audiences/audience-deletion-control";
import { AudienceMetadataEditor } from "../audiences/audience-metadata-editor";
import { InstagramAudienceEditor } from "../audiences/instagram-audience-editor";
import { LookalikeAudienceCreator } from "../audiences/lookalike-audience-creator";
import { WebsiteAudienceEditor } from "../audiences/website-audience-editor";

type LibraryResponse = { audiences: CustomAudienceView[]; hasNextPage: boolean; nextCursor?: string; queriedAt: string; limitations: string[] };

function estimateText(audience: CustomAudienceView): string {
  const lower = audience.approximateCountLowerBound;
  const upper = audience.approximateCountUpperBound;
  if (lower === undefined && upper === undefined) return "Estimativa indisponível";
  const format = new Intl.NumberFormat("pt-BR");
  return lower !== undefined && upper !== undefined ? `${format.format(lower)}–${format.format(upper)}` : format.format(lower ?? upper ?? 0);
}

const statusText = (status: { code?: number; description?: string } | undefined) => status ? [status.code, status.description].filter(Boolean).join(" — ") : "Não informado";

/** Same account-scoped manager used by the full library; it has no campaign-selection callback. */
export function AiAudienceLibraryDialog({ accountId, userId, open, onOpenChange }: { accountId: string; userId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setAfter(null); setLibrary(null); }, [accountId, userId]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const query = new URLSearchParams({ userId, detailed: "1" });
    if (after) query.set("after", after);
    setLoading(true); setError(null);
    void fetch(`/api/meta-marketing/${accountId}/audiences?${query}`).then(async (response) => {
      const body = await response.json().catch(() => ({})) as LibraryResponse & { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Não foi possível consultar os públicos.");
      return body;
    }).then((body) => { if (active) setLibrary(body); }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Não foi possível consultar os públicos."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, after, open, refreshKey, userId]);

  const refresh = () => setRefreshKey((current) => current + 1);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto"><DialogHeader><DialogTitle>Biblioteca de públicos</DialogTitle><DialogDescription>Cliente e conta atuais: {accountId}. Consulte e gerencie públicos sem selecioná-los automaticamente para esta campanha.</DialogDescription></DialogHeader>{loading ? <div className="flex justify-center p-10"><Loader2 className="size-6 animate-spin" aria-label="Carregando públicos" /></div> : null}{error ? <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</div> : null}{library ? <div className="space-y-4"><div className="grid gap-2 sm:grid-cols-3"><InstagramAudienceEditor accountId={accountId} userId={userId} onSaved={refresh} /><WebsiteAudienceEditor accountId={accountId} userId={userId} onSaved={refresh} /><LookalikeAudienceCreator accountId={accountId} userId={userId} audiences={library.audiences} onSaved={refresh} /></div><div className="divide-y rounded-md border">{library.audiences.map((audience) => <div className="space-y-2 p-3 text-sm" key={audience.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{audience.name ?? "Sem nome"}</p><p className="font-mono text-xs text-muted-foreground">{audience.id}</p><p className="text-xs text-muted-foreground">{audience.subtype ?? "Tipo não informado"} · {estimateText(audience)}</p></div><p className="text-xs text-muted-foreground">Processamento: {statusText(audience.operationStatus)}</p></div><div className="flex flex-wrap gap-2">{audience.capabilities.editMetadata === "available" ? <AudienceMetadataEditor audience={audience} accountId={accountId} userId={userId} onSaved={refresh} /> : null}<AudienceDeletionControl audience={audience} accountId={accountId} userId={userId} onDeleted={refresh} /><InstagramAudienceEditor accountId={accountId} userId={userId} audience={audience} onSaved={refresh} /><WebsiteAudienceEditor accountId={accountId} userId={userId} audience={audience} onSaved={refresh} /></div></div>)}{library.audiences.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Nenhum público acessível nesta página.</p> : null}</div><div className="flex items-center justify-between gap-3"><Button disabled={!after} onClick={() => setAfter(null)} type="button" variant="outline"><ChevronLeft />Anterior</Button><span className="text-xs text-muted-foreground">Consulta em {new Date(library.queriedAt).toLocaleString("pt-BR")}</span><Button disabled={!library.hasNextPage || !library.nextCursor} onClick={() => library.nextCursor && setAfter(library.nextCursor)} type="button" variant="outline">Próxima<ChevronRight /></Button></div><div className="space-y-1 rounded-md bg-muted/20 p-3 text-xs text-muted-foreground">{library.limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}</div></div> : null}</DialogContent></Dialog>;
}
