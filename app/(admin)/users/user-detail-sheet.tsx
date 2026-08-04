"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type UserDetailSheetProps = {
  userId: string | null;
  userEmail: string | null;
  open: boolean;
  onClose: () => void;
};

export function UserDetailSheet({
  userId,
  userEmail,
  open,
  onClose,
}: UserDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[75vw]"
      >
        <SheetHeader className="sticky top-0 z-10 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur-sm sm:px-6">
          <div className="flex items-center justify-between gap-3 pr-8">
            <div className="min-w-0">
              <SheetTitle className="truncate text-left text-base font-semibold">
                {userEmail ?? "Cliente"}
              </SheetTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Visualização rápida — o fluxo da lista permanece aberto
              </p>
            </div>
            {userId ? (
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link href={`/users/${userId}`} target="_blank">
                  Abrir página
                  <ExternalLink className="size-3.5" />
                </Link>
              </Button>
            ) : null}
          </div>
        </SheetHeader>

        {userId ? (
          <iframe
            key={userId}
            title={`Detalhes de ${userEmail ?? "cliente"}`}
            src={`/embed/users/${userId}`}
            className="h-full min-h-0 w-full flex-1 border-0 bg-background"
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
