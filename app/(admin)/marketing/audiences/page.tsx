"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdAccountSelector } from "../components/ad-account-selector";
import type { FacebookAdAccountBasicInfo } from "@/lib/meta-business/get-user-with-ad-accounts";
import { AudienceLibraryManager } from "./audience-library-manager";

export default function AudiencesPage() {
  const userId = useSearchParams().get("userId");
  const [accounts, setAccounts] = useState<FacebookAdAccountBasicInfo[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountUserId, setAccountUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void fetch(`/api/users/${userId}/ad-accounts`).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "Não foi possível carregar as contas do cliente.");
      return (body.data ?? []) as FacebookAdAccountBasicInfo[];
    }).then((items) => { if (active) { setAccounts(items); setAccountId(items[0]?.account_id ?? null); setAccountUserId(userId); } }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Não foi possível carregar as contas do cliente."); });
    return () => { active = false; };
  }, [userId]);

  if (!userId) return <main className="p-6"><Card><CardContent className="p-6 text-sm text-muted-foreground">Escolha um cliente no painel de marketing antes de abrir a biblioteca.</CardContent></Card></main>;
  const selectedAccountId = accountUserId === userId ? accountId : null;
  if (!selectedAccountId) return <main className="p-6"><Card><CardContent className="p-6 text-sm text-muted-foreground">Nenhuma conta de anúncios acessível para este cliente.</CardContent></Card></main>;

  return <main className="mx-auto max-w-6xl space-y-6 p-6">
    <Card><CardHeader className="flex-row items-center justify-between gap-4"><CardTitle className="flex items-center gap-2"><Users className="size-5" />Públicos</CardTitle><AdAccountSelector accounts={accounts.map((a) => ({ id: a.id, name: a.name ?? a.account_id, accountId: a.account_id }))} selectedAccountId={selectedAccountId} onSelectAccount={setAccountId} /></CardHeader></Card>
    <p className="text-sm text-muted-foreground">Biblioteca do cliente e da conta selecionados. A consulta é reautorizada no servidor; listar um público não libera suas demais ações.</p>
    {error ? <div role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertCircle className="size-4 shrink-0" />{error}</div> : null}
    {selectedAccountId ? <AudienceLibraryManager key={`${userId}:${selectedAccountId}`} userId={userId} accountId={selectedAccountId} /> : null}
  </main>;
}
