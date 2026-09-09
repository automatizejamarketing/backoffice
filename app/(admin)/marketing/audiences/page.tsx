"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdAccountSelector } from "../components/ad-account-selector";
import type { FacebookAdAccountBasicInfo } from "@/lib/meta-business/get-user-with-ad-accounts";
import type { CustomAudienceView } from "@/lib/meta-business/marketing/audiences/read";
import { AudienceDeletionControl } from "./audience-deletion-control";
import { WebsiteAudienceEditor } from "./website-audience-editor";
import { LookalikeAudienceCreator } from "./lookalike-audience-creator";

type LibraryResponse = { audiences: CustomAudienceView[]; hasNextPage: boolean; nextCursor?: string; queriedAt: string; limitations: string[] };

const statusText = (status: { code?: number; description?: string } | undefined) => status ? [status.code, status.description].filter(Boolean).join(" — ") : "Não informado";
function estimateText(audience: CustomAudienceView) {
  const low = audience.approximateCountLowerBound;
  const high = audience.approximateCountUpperBound;
  if (low === undefined && high === undefined) return "Estimativa indisponível";
  const format = new Intl.NumberFormat("pt-BR");
  return low !== undefined && high !== undefined ? `${format.format(low)}–${format.format(high)}` : format.format(low ?? high ?? 0);
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
  editRule: "Editar regra",
  manageMembers: "Alterar membros",
  delete: "Excluir objeto",
  lookalikeSource: "Origem de lookalike",
};

function capabilityText(audience: CustomAudienceView) {
  return (Object.keys(capabilityLabels) as Array<keyof CustomAudienceView["capabilities"]>)
    .map((capability) => `${capabilityLabels[capability]}: ${audience.capabilities[capability] === "available" ? "disponível" : "não confirmada"}`)
    .join("; ");
}

export default function AudiencesPage() {
  const userId = useSearchParams().get("userId");
  const [accounts, setAccounts] = useState<FacebookAdAccountBasicInfo[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void fetch(`/api/users/${userId}/ad-accounts`).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "Não foi possível carregar as contas do cliente.");
      return (body.data ?? []) as FacebookAdAccountBasicInfo[];
    }).then((items) => { if (active) { setAccounts(items); setAccountId(items[0]?.account_id ?? null); } }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Não foi possível carregar as contas do cliente."); });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    if (!userId || !accountId) return;
    let active = true;
    setLoading(true); setError(null); setLibrary(null);
    const query = new URLSearchParams({ userId, detailed: "1" });
    const after = cursors.at(-1); if (after) query.set("after", after);
    void fetch(`/api/meta-marketing/${accountId}/audiences?${query}`).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "Não foi possível consultar os públicos.");
      return body as LibraryResponse;
    }).then((body) => { if (active) setLibrary(body); }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Não foi possível consultar os públicos."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, cursors, userId]);

  if (!userId) return <main className="p-6"><Card><CardContent className="p-6 text-sm text-muted-foreground">Escolha um cliente no painel de marketing antes de abrir a biblioteca.</CardContent></Card></main>;

  return <main className="mx-auto max-w-6xl space-y-6 p-6">
    <Card><CardHeader className="flex-row items-center justify-between gap-4"><CardTitle className="flex items-center gap-2"><Users className="size-5" />Públicos</CardTitle><AdAccountSelector accounts={accounts.map((a) => ({ id: a.id, name: a.name, accountId: a.account_id }))} selectedAccountId={accountId} onSelectAccount={(next) => { setAccountId(next); setCursors([]); }} /></CardHeader></Card>
    <p className="text-sm text-muted-foreground">Biblioteca do cliente e da conta selecionados. A consulta é reautorizada no servidor; listar um público não libera suas demais ações.</p>
    {error ? <div role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertCircle className="size-4 shrink-0" />{error}</div> : null}
    {loading ? <div className="flex justify-center p-12"><Loader2 className="size-6 animate-spin" /></div> : null}
    {library ? <><WebsiteAudienceEditor accountId={accountId!} userId={userId} onSaved={() => setCursors((current) => [...current])} /><LookalikeAudienceCreator accountId={accountId!} userId={userId} audiences={library.audiences} onSaved={() => setCursors((current) => [...current])} /><Card><CardContent className="p-0"><ul className="divide-y">{library.audiences.map((audience) => <li key={audience.id} className="grid gap-3 p-5 text-sm md:grid-cols-5"><div><p className="font-medium">{audience.name ?? "Sem nome"}</p><p className="font-mono text-xs text-muted-foreground">{audience.id}</p><p className="text-xs text-muted-foreground">{audience.subtype ?? "Tipo não informado"}</p><div className="mt-2"><AudienceDeletionControl audience={audience} accountId={accountId!} userId={userId} onDeleted={() => setCursors((current) => [...current])} /></div><div className="mt-2"><WebsiteAudienceEditor accountId={accountId!} userId={userId} audience={audience} onSaved={() => setCursors((current) => [...current])} /></div></div><div>{ruleText(audience)}{audience.retentionDays !== undefined ? <p className="text-xs text-muted-foreground">Período: {audience.retentionDays} dias</p> : null}</div><div>Processamento: {statusText(audience.operationStatus)}</div><div>Disponibilidade: {statusText(audience.deliveryStatus)}</div><div>{estimateText(audience)}<p className="text-xs text-muted-foreground">{capabilityText(audience)}</p>{audience.originAudienceId ? <p className="font-mono text-xs text-muted-foreground">Origem: {audience.originAudienceId}</p> : null}</div></li>)}{library.audiences.length === 0 ? <li className="p-10 text-center text-sm text-muted-foreground">Nenhum público acessível nesta página.</li> : null}</ul></CardContent></Card><div className="flex items-center justify-between"><Button variant="outline" disabled={!cursors.length} onClick={() => setCursors((current) => current.slice(0, -1))}><ChevronLeft />Anterior</Button><span className="text-xs text-muted-foreground">Página {cursors.length + 1}</span><Button variant="outline" disabled={!library.hasNextPage || !library.nextCursor} onClick={() => library.nextCursor && setCursors((current) => [...current, library.nextCursor!])}>Próxima<ChevronRight /></Button></div><Card><CardContent className="space-y-1 p-4 text-xs text-muted-foreground">{library.limitations.map((item) => <p key={item}>{item}</p>)}</CardContent></Card></> : null}
  </main>;
}
