"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdCreativeDialog } from "./ad-creative-dialog";

type EditCreativeButtonProps = {
  accountId: string;
  userId: string;
  ad: { id: string; name?: string };
  onEdited: () => void;
};

export function EditCreativeButton({
  accountId,
  userId,
  ad,
  onEdited,
}: EditCreativeButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground hover:text-foreground"
        aria-label="Editar criativo"
        title="Editar criativo"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Pencil className="size-3.5" />
      </Button>

      {open && (
        <AdCreativeDialog
          mode="edit"
          accountId={accountId}
          userId={userId}
          ad={ad}
          isOpen={open}
          onClose={() => setOpen(false)}
          onEdited={onEdited}
        />
      )}
    </>
  );
}
