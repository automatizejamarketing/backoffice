"use client";

import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { navigateToFacebookOAuth } from "@/lib/meta-business/navigate-facebook-oauth";
import { DEFAULT_AUTOMATIZE_BUSINESS_ID } from "@/lib/meta-business/partner-access-status";
import type { SanitizedMetaBusinessAccount } from "@/lib/meta-business/sanitize";

const PARTNERS_FALLBACK = "https://business.facebook.com/latest/settings/partners";

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
  const [isChecking, setIsChecking] = useState(false);

  const refreshAccess = useCallback(async () => {
    setIsChecking(true);
    try {
      const res = await fetch(`/api/users/${userId}/meta-account/partner-access`);
      const data = res.ok ? ((await res.json()) as PartnerAccessResponse) : null;
      setInfo(data);
    } catch {
      setInfo(null);
    } finally {
      setIsChecking(false);
    }
  }, [userId]);

  useEffect(() => {
    void refreshAccess();
  }, [refreshAccess, metaAccount.id]);

  const businessId = info?.automatizeBusinessId ?? DEFAULT_AUTOMATIZE_BUSINESS_ID;

  const copyBusinessId = async (announce = true) => {
    try {
      await navigator.clipboard.writeText(businessId);
      if (announce) toast.success("ID copiado");
      return true;
    } catch {
      if (announce) toast.error("Não foi possível copiar o ID");
      return false;
    }
  };

  const openPartners = async () => {
    const copied = await copyBusinessId(false);
    if (copied) toast.success("ID copiado. Cole no Facebook.");
    window.open(info?.partnersUrl ?? PARTNERS_FALLBACK, "_blank", "noopener,noreferrer");
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
        onRetried();
        return;
      }
      navigateToFacebookOAuth(body.authUrl);
    } catch {
      toast.error("Erro ao iniciar a reconexão administrativa.");
      onRetried();
    } finally {
      setIsStarting(false);
    }
  };

  const status = info?.status ?? metaAccount.partnerAccessStatus;
  const ready = status === "complete" || status === "unsupported";

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-foreground">
          Acesso por parceiro
        </h3>
        <Badge variant="outline">{statusLabel(status)}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {ready
          ? "Página, Instagram e conta já estão com a Automatize."
          : "Reconectar o Facebook não basta. O cliente precisa atribuir Página, Instagram e conta à Automatize."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {!ready ? (
          <Button onClick={() => void openPartners()} size="sm" type="button">
            <ExternalLink className="size-4" />
            Abrir Parceiros
          </Button>
        ) : null}
        <Button
          disabled={isChecking}
          onClick={() => void refreshAccess()}
          size="sm"
          type="button"
          variant="outline"
        >
          {isChecking ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          Verificar
        </Button>
        <Button
          disabled={isStarting}
          onClick={() => void startAdminReconnect()}
          size="sm"
          type="button"
          variant="outline"
        >
          {isStarting ? "Abrindo Meta..." : "Reconectar como consultor"}
        </Button>
      </div>
      <button
        className="inline-flex max-w-full items-center gap-2 rounded-md border border-border/80 bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/60"
        onClick={() => void copyBusinessId()}
        type="button"
      >
        <span>ID</span>
        <span className="truncate font-mono">{businessId}</span>
        <Copy className="size-3.5 shrink-0" />
      </button>
    </div>
  );
}
