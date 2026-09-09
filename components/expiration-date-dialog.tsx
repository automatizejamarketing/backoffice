"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ExpirationDateControl } from "@/components/expiration-date-control";

export function ExpirationDateDialog({
  userId,
  expirationDate,
}: {
  userId: string;
  expirationDate: Date | string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="size-3.5" />
          Editar data
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Data de expiração do acesso</DialogTitle>
          <DialogDescription>
            Até quando as áreas protegidas ficam liberadas. Cada alteração pede
            confirmação e fica registrada no histórico.
          </DialogDescription>
        </DialogHeader>
        <ExpirationDateControl
          userId={userId}
          expirationDate={expirationDate}
          variant="plain"
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
