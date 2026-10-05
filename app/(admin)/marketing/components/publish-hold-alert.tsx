"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { navigateToFacebookOAuth } from "@/lib/meta-business/navigate-facebook-oauth";

type PublishHoldRow = {
  id: string;
  flow: string;
  status: string;
  adAccountId: string;
  campaignName: string | null;
  reasonCode: string;
  createdAt: string;
};

type ConsultantCredentialStatus = {
  connectedAt: string | null;
  needsConnect: boolean;
};

export function PublishHoldAlert({ userId }: { userId: string }) {
  const [holds, setHolds] = useState<PublishHoldRow[]>([]);
  const [credential, setCredential] = useState<ConsultantCredentialStatus | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  // Saves the consultant's own personal token. The customer's connection is
  // not changed; the held publishes are retried with it right after.
  const connectPersonalFacebook = async () => {
    const confirmed = window.confirm(
      "Vai abrir o login da Meta no SEU Facebook pessoal. A conexão do cliente não muda: o seu acesso fica guardado para publicar quando a Meta recusar por certificação.",
    );
    if (!confirmed) return;
    setIsStarting(true);
    try {
      const res = await fetch(
        `/api/users/${userId}/meta-account/admin-reconnect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirm: true,
            purpose: "consultant_credential",
          }),
        },
      );
      const body = (await res.json().catch(() => null)) as {
        authUrl?: string;
      } | null;
      if (res.ok && body?.authUrl) {
        navigateToFacebookOAuth(body.authUrl);
        return;
      }
      toast.error("Não foi possível abrir o login do seu Facebook.");
    } catch {
      toast.error("Não foi possível abrir o login do seu Facebook.");
    }
    setIsStarting(false);
  };

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/users/${userId}/meta-account/publish-holds`)
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            holds?: PublishHoldRow[];
            consultantCredential?: ConsultantCredentialStatus;
          } | null,
        ) => {
          if (cancelled) return;
          setHolds(data?.holds ?? []);
          setCredential(data?.consultantCredential ?? null);
        },
      )
      .catch(() => {
        if (!cancelled) setHolds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (holds.length === 0) {
    if (!credential?.needsConnect) return null;
    return (
      <div className="space-y-2 rounded-md border border-border bg-muted/40 p-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline">Certificação Meta</Badge>
          <p className="text-sm font-medium text-foreground">
            {credential.connectedAt
              ? "Seu Facebook pessoal foi conectado há 50 dias ou mais"
              : "Seu Facebook pessoal não está conectado"}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Quando a Meta recusar uma publicação por certificação, o seu acesso
          é usado para publicar. Ele vale para todos os clientes. Este cliente
          não tem publicações seguradas, então nada é republicado agora.
        </p>
        <Button size="sm" onClick={connectPersonalFacebook} disabled={isStarting}>
          {isStarting ? "Abrindo..." : "Conectar meu Facebook pessoal"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-4">
      <div className="flex items-center gap-2">
        <Badge variant="outline">Certificação Meta</Badge>
        <p className="text-sm font-medium text-foreground">
          {holds.length === 1
            ? "1 publicação esperando o consultor"
            : `${holds.length} publicações esperando o consultor`}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        O token do cliente não publicou e nenhum consultor com acesso a esta
        conta tem o Facebook pessoal guardado. Conecte o seu para publicar. Se
        o Gerenciador de Negócios for recente, o cliente precisa antes convidar
        a Automatize em Pessoas.
      </p>
      <Button size="sm" onClick={connectPersonalFacebook} disabled={isStarting}>
        {isStarting ? "Abrindo..." : "Conectar meu Facebook pessoal"}
      </Button>
      <ul className="space-y-1 text-sm text-foreground">
        {holds.map((hold) => (
          <li key={hold.id}>
            {hold.campaignName?.trim() || "Campanha sem nome"} · {hold.adAccountId}
          </li>
        ))}
      </ul>
    </div>
  );
}
