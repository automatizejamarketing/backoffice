"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GrantCall } from "@/lib/meta-business/access-grant-test";

const DEFAULT_PARTNER_BM = "513671098485874";
const DEFAULT_PEOPLE_EMAIL = "contato@automatizemarketing.com";

type GrantTestResponse = {
  adAccountId: string | null;
  clientBusinessId: string | null;
  tokenKind: string;
  action: string;
  result: GrantCall | null;
  partners: GrantCall | null;
  pending: GrantCall | null;
  message?: string;
};

function describe(call: GrantCall | null): string {
  if (!call) return "—";
  if (call.ok) return `OK (HTTP ${call.httpStatus}) ${JSON.stringify(call.data)}`;
  return `Erro ${call.code ?? "?"}/${call.subcode ?? "-"} (HTTP ${call.httpStatus}): ${call.message ?? ""}`;
}

/**
 * Test tool: can the client's own token add the Automatize partner BM to the
 * ad account, or invite Automatize in People, without a click from the client?
 * Each button changes the client's account for real and has its undo.
 */
export function AccessGrantTestPanel({ userId }: { userId: string }) {
  const [businessId, setBusinessId] = useState(DEFAULT_PARTNER_BM);
  const [email, setEmail] = useState(DEFAULT_PEOPLE_EMAIL);
  const [pendingUserId, setPendingUserId] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [response, setResponse] = useState<GrantTestResponse | null>(null);

  const run = async (action: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setRunning(action);
    try {
      const res = await fetch(`/api/users/${userId}/meta-account/access-grant-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, businessId, email, pendingUserId }),
      });
      const body = (await res.json().catch(() => null)) as GrantTestResponse | null;
      setResponse(body ?? { message: "Resposta vazia." } as GrantTestResponse);
    } catch {
      setResponse({ message: "Falha de rede." } as GrantTestResponse);
    }
    setRunning(null);
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Teste de acesso</Badge>
        <p className="text-sm text-muted-foreground">
          Usa o token do cliente para dar acesso à Automatize sem clique dele.
          Os botões de conceder alteram a conta de verdade; use os de desfazer
          depois.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Parceiro na conta de anúncios</p>
        <Input value={businessId} onChange={(e) => setBusinessId(e.target.value)} placeholder="ID do BM parceiro" />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={running !== null}
            onClick={() =>
              run("add_partner", `Adicionar o BM ${businessId} como parceiro da conta de anúncios do cliente?`)
            }
          >
            {running === "add_partner" ? "Adicionando..." : "Adicionar parceiro"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={running !== null}
            onClick={() => run("remove_partner", `Remover o BM ${businessId} da conta de anúncios do cliente?`)}
          >
            {running === "remove_partner" ? "Removendo..." : "Remover parceiro"}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Pessoas no BM do cliente</p>
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={running !== null}
            onClick={() => run("invite_person", `Convidar ${email} como admin do BM do cliente?`)}
          >
            {running === "invite_person" ? "Convidando..." : "Convidar em Pessoas"}
          </Button>
        </div>
        <Input
          value={pendingUserId}
          onChange={(e) => setPendingUserId(e.target.value)}
          placeholder="ID do convite pendente (aparece na lista abaixo)"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={running !== null}
          onClick={() => run("cancel_invite", `Cancelar o convite ${pendingUserId}?`)}
        >
          {running === "cancel_invite" ? "Cancelando..." : "Cancelar convite"}
        </Button>
      </div>

      <Button size="sm" variant="ghost" disabled={running !== null} onClick={() => run("list")}>
        {running === "list" ? "Lendo..." : "Ver parceiros e convites atuais"}
      </Button>

      {response ? (
        <div className="space-y-1 break-all text-xs text-muted-foreground">
          {response.message ? <p className="text-red-600">{response.message}</p> : null}
          <p>
            Conta {response.adAccountId ?? "—"} · BM do cliente {response.clientBusinessId ?? "—"} · token{" "}
            {response.tokenKind}
          </p>
          <p className="text-foreground">Ação {response.action}: {describe(response.result)}</p>
          <p>Parceiros: {describe(response.partners)}</p>
          <p>Convites pendentes: {describe(response.pending)}</p>
        </div>
      ) : null}
    </div>
  );
}
