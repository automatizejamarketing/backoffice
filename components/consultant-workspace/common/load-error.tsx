"use client";

import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Primeira leitura falhou (sem nada em cache para mostrar). */
export function LoadError({ what, error, onRetry, retrying }: { what: string; error: unknown; onRetry: () => void; retrying: boolean }) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-sm font-medium">Não deu para carregar {what}.</p>
      <p className="max-w-md text-xs text-muted-foreground">
        {error instanceof Error ? error.message : "Erro inesperado."}
      </p>
      <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
        <RotateCw className={retrying ? "animate-spin" : undefined} /> Tentar de novo
      </Button>
    </div>
  );
}
