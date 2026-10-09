"use client";

import { useId, type ReactNode } from "react";
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
  describeAdAccountMoneyError,
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

function MoneyView({ data }: { data: AdAccountMoneyResponse }) {
  const view = describeAdAccountMoney(data);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
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
          <span className="min-w-0 break-words text-sm font-semibold text-foreground">
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
  accountSelector,
}: {
  userId: string;
  accountId: string;
  accountSelector: ReactNode;
}) {
  const headingId = useId();
  const query = useAdAccountMoney(userId, accountId);
  const refresh = useRefreshAdAccountMoney(userId);
  const isRefreshingThisAccount = refresh.isPending && refresh.variables === accountId;
  const isReading = query.isFetching || isRefreshingThisAccount;
  const errorText = query.isError ? describeAdAccountMoneyError(query.error) : null;

  function handleRefresh() {
    refresh.mutate(accountId, {
      onError: (error) => {
        toast.error("Não foi possível atualizar o saldo", {
          description: describeAdAccountMoneyError(error).message,
        });
      },
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-3 lg:flex-row lg:items-center" aria-labelledby={headingId}>
      <h3 id={headingId} className="sr-only">
        Saldo / fatura na Meta
      </h3>
      <div className="w-full min-w-0 shrink-0 lg:w-[320px]">
        {accountSelector}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
        {query.isPending ? (
          <p className="text-sm text-muted-foreground">Consultando a Meta…</p>
        ) : query.isError ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">
              Não foi possível consultar o saldo
            </p>
            <p className="break-words text-xs text-muted-foreground">{errorText?.message}</p>
            {errorText?.solution && (
              <p className="break-words text-xs text-muted-foreground">{errorText.solution}</p>
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
          <div className="contents">
            <MoneyView data={query.data} />
            <div className="ml-auto flex shrink-0 items-center gap-2">
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
