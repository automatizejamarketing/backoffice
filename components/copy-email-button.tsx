"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyEmailButton({ email }: { email: string }) {
  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(email);
      toast.success("E-mail copiado.");
    } catch {
      toast.error("Não foi possível copiar o e-mail.");
    }
  }

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="size-8 shrink-0"
      title="Copiar e-mail"
      aria-label={`Copiar e-mail ${email}`}
      onClick={() => void copyEmail()}
    >
      <Copy className="size-4" aria-hidden="true" />
    </Button>
  );
}
