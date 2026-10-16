"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * Marketing do cliente numa janela lateral, sem sair do dossiê — o mesmo
 * embed (`/embed/users/:id?tab=marketing`) da visualização rápida da lista de
 * usuários.
 */

type MarketingSheetApi = { open: () => void };

const MarketingSheetContext = createContext<MarketingSheetApi>({ open: () => undefined });

export function useMarketingSheet() {
  return useContext(MarketingSheetContext);
}

export function MarketingSheetProvider({
  userId,
  clientName,
  children,
}: {
  userId: string;
  clientName: string;
  children: React.ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  const open = useCallback(() => setOpened(true), []);
  const api = useMemo(() => ({ open }), [open]);
  const pageHref = `/users/${userId}?tab=marketing`;

  return (
    <MarketingSheetContext.Provider value={api}>
      {children}
      <Sheet open={opened} onOpenChange={setOpened}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[80vw]"
        >
          <SheetHeader className="border-b border-border/60 bg-background/95 px-4 py-3 sm:px-6">
            <div className="flex items-center justify-between gap-3 pr-8">
              <div className="min-w-0">
                <SheetTitle className="truncate text-left text-base font-semibold">Marketing · {clientName}</SheetTitle>
                <SheetDescription className="mt-0.5 text-xs">
                  Campanhas, criativos e cadastro do cliente — o dossiê continua aberto atrás.
                </SheetDescription>
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link href={pageHref} target="_blank">
                  Abrir em nova aba <ExternalLink className="size-3.5" />
                </Link>
              </Button>
            </div>
          </SheetHeader>
          <iframe
            title={`Marketing de ${clientName}`}
            src={`/embed/users/${userId}?tab=marketing`}
            className="h-full min-h-0 w-full flex-1 border-0 bg-background"
          />
        </SheetContent>
      </Sheet>
    </MarketingSheetContext.Provider>
  );
}
