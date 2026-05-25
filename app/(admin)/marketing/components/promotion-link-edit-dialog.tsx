"use client";

import { useEffect, useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PromotionLinkEditDialogProps = {
  accountId: string;
  userId: string;
  ad: { id: string; name?: string };
  onUpdated: () => void;
};

type PromotionLinkResponse = {
  promotionUrl?: string;
  message?: string;
  error?: string;
};

type PromotionLinkPatchResponse = {
  strategy?: "repoint" | "duplicate_paused";
  message?: string;
  error?: string;
};

function isValidHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function PromotionLinkEditDialog({
  accountId,
  userId,
  ad,
  onUpdated,
}: PromotionLinkEditDialogProps) {
  const [open, setOpen] = useState(false);
  const [promotionUrl, setPromotionUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function loadCurrentLink() {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ userId });
        const response = await fetch(
          `/api/meta-marketing/${accountId}/ads/${ad.id}/promotion-link?${params}`,
        );
        const data = (await response
          .json()
          .catch(() => ({}))) as PromotionLinkResponse;

        if (!response.ok) {
          throw new Error(
            data.message ?? "Não foi possível carregar o link atual.",
          );
        }

        if (!cancelled) {
          setPromotionUrl(data.promotionUrl ?? "");
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Não foi possível carregar o link atual.",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadCurrentLink();

    return () => {
      cancelled = true;
    };
  }, [accountId, ad.id, open, userId]);

  async function handleSave() {
    const nextUrl = promotionUrl.trim();
    if (!isValidHttpsUrl(nextUrl)) {
      setError("Informe uma URL válida começando com https://.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const params = new URLSearchParams({ userId });
      const response = await fetch(
        `/api/meta-marketing/${accountId}/ads/${ad.id}/promotion-link?${params}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ promotionUrl: nextUrl }),
        },
      );
      const data = (await response
        .json()
        .catch(() => ({}))) as PromotionLinkPatchResponse;

      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível atualizar o link.");
      }

      toast.success(
        data.strategy === "duplicate_paused"
          ? "Novo anúncio criado com o link atualizado."
          : "Link de promoção atualizado.",
      );
      if (data.message) toast.message(data.message);
      setOpen(false);
      onUpdated();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível atualizar o link.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground hover:text-foreground"
        aria-label="Editar link de promoção"
        title="Editar link de promoção"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <Link2 className="size-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onClick={(event) => event.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Editar link de promoção</DialogTitle>
            <DialogDescription>
              Altere a URL de destino deste anúncio de vendas. A Meta pode
              enviar o anúncio para nova revisão após a mudança.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor={`link-${ad.id}`}>
              URL de promoção
            </label>
            <Input
              id={`link-${ad.id}`}
              value={promotionUrl}
              onChange={(event) => setPromotionUrl(event.target.value)}
              placeholder="https://sua-promocao.com"
              disabled={isLoading || isSaving}
            />
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                O link deve começar com https://.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={isLoading || isSaving || !promotionUrl.trim()}
            >
              {isLoading || isSaving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {isLoading ? "Carregando..." : "Salvando..."}
                </>
              ) : (
                "Salvar link"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
