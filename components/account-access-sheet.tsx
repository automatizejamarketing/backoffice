"use client";

import { useCallback, useEffect, useState } from "react";
import { ExpirationDateControl } from "@/components/expiration-date-control";
import { AccountHistoryTimeline } from "@/components/account-history-timeline";
import type { SerializedAccountHistoryItem } from "@/lib/backoffice/account-history";
import { loadUserAccountHistory } from "@/lib/backoffice/load-account-history";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function AccountAccessSheet({
  open,
  onOpenChange,
  userId,
  userEmail,
  expirationDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userEmail: string;
  expirationDate: Date | string | null;
}) {
  const [history, setHistory] = useState<SerializedAccountHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const items = await loadUserAccountHistory(userId);
      setHistory(items);
    } catch (loadError) {
      console.error("[account-history] failed to load", loadError);
      setHistory([]);
      setError("Não foi possível carregar o histórico.");
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    void loadHistory();
  }, [open, loadHistory]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg"
        side="right"
      >
        <SheetHeader className="border-b px-6 py-4 text-left">
          <SheetTitle>Alterar acesso</SheetTitle>
          <SheetDescription className="truncate">{userEmail}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-6 py-5">
          <div className="space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-medium">Acesso à plataforma</h3>
              <p className="text-xs text-muted-foreground">
                Até quando as áreas protegidas ficam liberadas
              </p>
            </div>
            <ExpirationDateControl
              userId={userId}
              expirationDate={expirationDate}
              variant="plain"
              onSaved={() => void loadHistory()}
            />
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Histórico da conta</h3>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : (
              <AccountHistoryTimeline items={history} isLoading={isLoading} />
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
