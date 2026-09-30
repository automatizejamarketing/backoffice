"use client";

import { useId } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AdAccountMoneyResponse } from "@/lib/backoffice/ad-account-money-types";
import { formatTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import {
  describeAdAccountMoney,
  type AdAccountMoneyTone,
} from "@/lib/backoffice/describe-ad-account-money";
import { cn } from "@/lib/utils";
import {
  AdAccountMoneyRequestError,
  useAdAccountMoney,
  useRefreshAdAccountMoney,
} from "../hooks/use-ad-account-money";

const TONE_BADGE: Record<
  AdAccountMoneyTone,
  { variant: "secondary" | "destructive" | "outline"; className?: string }
> = {
  neutral: { variant: "secondary" },
  warning: {
    variant: "outline",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  destructive: { variant: "destructive" },
  outline: { variant: "outline" },
};

function describeError(error: unknown): { message: string; solution?: string } {
  if (error instanceof AdAccountMoneyRequestError && error.body?.message) {
    return { message: error.body.message, solution: error.body.solution };
  }
  return { message: "Verifique a conexão e tente de novo." };
}

function MoneyView({ data }: { data: AdAccountMoneyResponse }) {
  const view = describeAdAccountMoney(data);
  return (
    <div className="space-y-2">
      {(view.typeLabel || view.status) && (
        <div className="flex flex-wrap items-center gap-2">
          {view.typeLabel && (
            <span className="text-xs font-medium text-muted-foreground">{view.typeLabel}</span>
          )}
          {view.status && (
            <Badge
              variant={TONE_BADGE[view.status.tone].variant}
              className={TONE_BADGE[view.status.tone].className}
            >
              {view.status.label}
            </Badge>
          )}
        </div>
      )}

      {view.main.kind === "amount" && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {view.main.label && (
            <span className="text-sm text-muted-foreground">{view.main.label}</span>
          )}
          <span className="min-w-0 break-words text-lg font-semibold text-foreground">
            {view.main.value}
          </span>
        </div>
      )}

      {view.main.kind === "blocked" && (
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">{view.main.title}</p>
            <p className="break-words text-xs text-muted-foreground">{view.main.reason}</p>
          </div>
        </div>
      )}

      {view.main.kind === "empty" && (
        <p className="text-sm text-muted-foreground">{view.main.text}</p>
      )}
    </div>
  );
}

export function AdAccountMoneyPanel({
  userId,
  accountId,
}: {
  userId: string;
  accountId: string;
}) {
  const headingId = useId();
  const query = useAdAccountMoney(userId, accountId);
  const refresh = useRefreshAdAccountMoney(userId);
  const isRefreshingThisAccount = refresh.isPending && refresh.variables === accountId;
  const isReading = query.isFetching || isRefreshingThisAccount;

  function handleRefresh() {
    refresh.mutate(accountId, {
      onError: (error) => {
        toast.error("Não foi possível atualizar o saldo", {
          description: describeError(error).message,
        });
      },
    });
  }

  return (
    <section className="space-y-2" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-medium text-foreground">
        Saldo / fatura na Meta
      </h3>
      <div className="rounded-md border border-border bg-muted/30 p-4">
        {query.isPending ? (
          <p className="text-sm text-muted-foreground">Consultando a Meta…</p>
        ) : query.isError ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">
              Não foi possível consultar o saldo
            </p>
            <p className="break-words text-xs text-muted-foreground">
              {describeError(query.error).message}
            </p>
            {describeError(query.error).solution && (
              <p className="break-words text-xs text-muted-foreground">
                {describeError(query.error).solution}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
              disabled={isReading}
            >
              Tentar de novo
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <MoneyView data={query.data} />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
              <span className="text-xs text-muted-foreground">
                Atualizado às {formatTimeInSaoPaulo(query.data.fetchedAt)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={isReading}
              >
                <RefreshCw className={cn("h-4 w-4", isReading && "animate-spin")} aria-hidden />
                Atualizar
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
