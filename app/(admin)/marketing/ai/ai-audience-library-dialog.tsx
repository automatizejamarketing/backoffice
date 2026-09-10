"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AudienceLibraryManager } from "../audiences/audience-library-manager";

/**
 * The campaign entry point for the same audience manager as the standalone
 * library. It has no selection callback, so managing a library object cannot
 * change campaign answers or targeting.
 */
export function AiAudienceLibraryDialog({ accountId, userId, open, onOpenChange }: { accountId: string; userId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Biblioteca de públicos</DialogTitle>
          <DialogDescription>
            Cliente e conta atuais: {accountId}. Consulte e gerencie públicos sem selecioná-los automaticamente para esta campanha.
          </DialogDescription>
        </DialogHeader>

        {open ? <AudienceLibraryManager key={`${userId}:${accountId}`} userId={userId} accountId={accountId} /> : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Voltar à campanha</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
