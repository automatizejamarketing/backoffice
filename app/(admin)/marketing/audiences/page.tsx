"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdAccountSelector } from "../components/ad-account-selector";
import type { AdAccountWithSelection } from "@/app/api/users/[id]/ad-accounts/route";
import { AudienceLibraryManager } from "./audience-library-manager";
import { resolveAudienceAccountId } from "./audience-account-selection";

type AccountState = { requestedAccountId: string | null } & (
  | { status: "loading"; userId: string | null }
  | { status: "error"; userId: string; message: string }
  | { status: "ready"; userId: string; accounts: AdAccountWithSelection[]; selectedAccountId: string | null }
);

export default function AudiencesPage() {
  const searchParams = useSearchParams();
  const userId = searchParams.get("userId");
  const requestedAccountId = searchParams.get("accountId");
  const [accountState, setAccountState] = useState<AccountState>({ status: "loading", userId: null, requestedAccountId });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setAccountState({ status: "loading", userId, requestedAccountId });
    if (!userId) return;
    let active = true;
    void fetch(`/api/users/${encodeURIComponent(userId)}/ad-accounts`).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "Não foi possível carregar as contas do cliente.");
      return (body.data ?? []) as AdAccountWithSelection[];
    }).then((items) => {
      if (!active) return;
      setAccountState({ status: "ready", userId, requestedAccountId, accounts: items, selectedAccountId: resolveAudienceAccountId(items, requestedAccountId) });
    }).catch((caught) => {
      if (!active) return;
      setAccountState({ status: "error", userId, requestedAccountId, message: caught instanceof Error ? caught.message : "Não foi possível carregar as contas do cliente." });
    });
    return () => { active = false; };
  }, [userId, requestedAccountId, retry]);

  // A new URL boundary hides the old manager synchronously, before the loading effect runs.
  const current = accountState.userId === userId && accountState.requestedAccountId === requestedAccountId;
  const ready = current && accountState.status === "ready" ? accountState : null;
  const selectedAccountId = ready?.selectedAccountId ?? null;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <Card>
        <CardHeader className="flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2"><Users className="size-5" />Públicos</CardTitle>
          {ready?.accounts.length ? (
            <AdAccountSelector
              accounts={ready.accounts.map((account) => ({
                id: account.id,
                name: account.name ?? account.account_id,
                accountId: resolveAudienceAccountId([account], null) ?? account.account_id,
                enabled: account.enabled,
                primary: account.primary,
              }))}
              selectedAccountId={selectedAccountId}
              onSelectAccount={(value) => setAccountState((previous) =>
                previous.status === "ready" && previous.userId === userId
                  ? { ...previous, selectedAccountId: resolveAudienceAccountId(previous.accounts, value) }
                  : previous,
              )}
            />
          ) : null}
        </CardHeader>
      </Card>
      {!userId ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Escolha um cliente no painel de marketing antes de abrir a biblioteca.</CardContent></Card>
      ) : !current || accountState.status === "loading" ? (
        <p role="status" className="text-sm text-muted-foreground">Carregando contas de anúncios…</p>
      ) : accountState.status === "error" ? (
        <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <p className="flex gap-2"><AlertCircle className="size-4 shrink-0" />{accountState.message}</p>
          <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</Button>
        </div>
      ) : !ready?.accounts.length ? (
        <p className="text-sm text-muted-foreground">Nenhuma conta de anúncios acessível para este cliente.</p>
      ) : !selectedAccountId ? (
        <p role="alert" className="text-sm text-destructive">A conta solicitada não está disponível para este cliente. Selecione uma conta acessível para continuar.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Biblioteca do cliente e da conta selecionados. A consulta é reautorizada no servidor; listar um público não libera suas demais ações.</p>
          <AudienceLibraryManager key={`${userId}:${selectedAccountId}`} userId={userId} accountId={selectedAccountId} />
        </>
      )}
    </main>
  );
}
