"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { SanitizedMetaBusinessAccount } from "@/lib/meta-business/sanitize";

type PartnerAccessResponse = {
  status?: string | null;
  clientBusinessId?: string | null;
  automatizeBusinessId?: string;
  partnersUrl?: string | null;
  instructions?: string[];
};

type PartnerAccessPanelProps = {
  userId: string;
  metaAccount: SanitizedMetaBusinessAccount;
  onRetried: () => void;
};

function statusLabel(status: string | null | undefined): string {
  if (status === "complete") return "completo";
  if (status === "pending_admin_approval") return "aguardando admin";
  if (status === "partial") return "parcial";
  if (status === "unsupported") return "conta pessoal";
  if (status === "missing") return "ausente";
  return "não verificado";
}

export function PartnerAccessPanel({
  userId,
  metaAccount,
  onRetried,
}: PartnerAccessPanelProps) {
  const [info, setInfo] = useState<PartnerAccessResponse | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/users/${userId}/meta-account/partner-access`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, metaAccount.id]);

  const copyInstructions = async () => {
    const lines = info?.instructions ?? [];
    const text = [
      ...lines,
      info?.partnersUrl ? `Link: ${info.partnersUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Instruções copiadas");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  const startAdminReconnect = async () => {
    const confirmed = window.confirm(
      "Você vai autorizar com o SEU Facebook de consultor. Não use a senha do cliente. Os ativos retornados precisam intersectar os ativos conhecidos deste cliente.",
    );
    if (!confirmed) return;

    setIsStarting(true);
    try {
      const res = await fetch(
        `/api/users/${userId}/meta-account/admin-reconnect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        },
      );
      const body = (await res.json().catch(() => null)) as
        | { authUrl?: string; error?: string }
        | null;
      if (!res.ok || !body?.authUrl) {
        toast.error("Não foi possível iniciar a reconexão administrativa.");
        return;
      }
      window.location.href = body.authUrl;
    } catch {
      toast.error("Erro ao iniciar a reconexão administrativa.");
    } finally {
      setIsStarting(false);
      onRetried();
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-foreground">
          Acesso por parceiro
        </h3>
        <Badge variant="outline">
          {statusLabel(info?.status ?? metaAccount.partnerAccessStatus)}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Completo só quando Página, Instagram e conta de anúncios estão
        atribuídos à BM Automatize. Nunca peça a senha do cliente.
      </p>
      {info?.automatizeBusinessId ? (
        <p className="font-mono text-xs text-muted-foreground">
          ID Automatize: {info.automatizeBusinessId}
        </p>
      ) : null}
      {info?.clientBusinessId ? (
        <p className="text-xs text-muted-foreground">
          BM do cliente: {info.clientBusinessId}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {info?.partnersUrl ? (
          <Button asChild size="sm" variant="outline">
            <a href={info.partnersUrl} rel="noopener noreferrer" target="_blank">
              Abrir Parceiros
            </a>
          </Button>
        ) : null}
        <Button onClick={() => void copyInstructions()} size="sm" variant="outline">
          Copiar instruções
        </Button>
        <Button
          disabled={isStarting}
          onClick={() => void startAdminReconnect()}
          size="sm"
        >
          {isStarting ? "Abrindo Meta..." : "Reconectar como consultor"}
        </Button>
      </div>
    </div>
  );
}
