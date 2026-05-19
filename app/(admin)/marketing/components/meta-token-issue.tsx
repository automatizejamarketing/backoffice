"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AdAccountsErrorResponse } from "@/app/api/users/[id]/ad-accounts/route";
import type { ReconnectInfo } from "@/lib/meta-business/reconnect-link";

type RefreshResponse = {
  ok: boolean;
  status: "refreshed" | "needs_reconnect" | "error";
  newExpiresAt?: string;
  clientError?: { error: string; message: string; solution: string };
  reconnect?: ReconnectInfo;
};

type MetaTokenIssueProps = {
  userId: string;
  error: AdAccountsErrorResponse;
  onRetried: () => void;
};

export function MetaTokenIssue({
  userId,
  error,
  onRetried,
}: MetaTokenIssueProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [reconnect, setReconnect] = useState<ReconnectInfo | null>(
    error.reconnect ?? null,
  );

  const handleCopy = async () => {
    if (!reconnect) return;
    try {
      await navigator.clipboard.writeText(reconnect.url);
      toast.success("Link de reconexão copiado");
    } catch {
      toast.error("Não foi possível copiar. Copie o link manualmente.");
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch(
        `/api/users/${userId}/meta-account/refresh-token`,
        { method: "POST" },
      );
      const body = (await res
        .json()
        .catch(() => null)) as RefreshResponse | null;

      if (res.ok && body?.status === "refreshed") {
        toast.success("Token renovado com sucesso");
        onRetried();
        return;
      }

      if (body?.reconnect) setReconnect(body.reconnect);

      if (body?.status === "needs_reconnect") {
        toast.error(
          body.clientError?.message ??
            "Não foi possível renovar. O usuário precisa reconectar a conta do Facebook.",
        );
      } else {
        toast.error(
          body?.clientError?.message ??
            "Falha ao renovar o token. Tente novamente.",
        );
      }
    } catch {
      toast.error("Erro ao contatar o servidor.");
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-destructive/50 bg-destructive/5 p-4">
      <div className="flex items-center gap-2">
        <Badge variant="destructive">Conexão inválida</Badge>
        <p className="text-sm font-medium text-foreground">{error.error}</p>
      </div>

      <p className="text-sm text-foreground">{error.message}</p>
      {error.solution && (
        <p className="text-sm text-muted-foreground">{error.solution}</p>
      )}

      {reconnect && (
        <div className="space-y-2 rounded-md border border-border bg-background/60 p-3">
          <p className="text-xs text-muted-foreground">
            {reconnect.instructions}
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={reconnect.url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={isRefreshing}
            >
              Copiar link de reconexão
            </Button>
          </div>
        </div>
      )}

      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? "Renovando..." : "Tentar renovar token"}
        </Button>
      </div>
    </div>
  );
}
