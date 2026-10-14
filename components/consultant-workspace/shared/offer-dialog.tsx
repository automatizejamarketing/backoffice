"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lightbulb, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OfferSuggestion, OfferSuggestionResult } from "@/lib/consultant-workspace/offer-suggestion";

const STEPS = ["Lendo o negócio e o cardápio…", "Comparando com os anúncios que funcionam…", "Montando as ofertas…"];

/**
 * "Sugerir oferta/combo": a IA propõe 3 opções para o criativo ruim; a
 * escolhida abre a mensagem da Mat já preenchida (dá para editar antes).
 */
export function OfferSuggestionDialog({
  open,
  onOpenChange,
  userId,
  adIds,
  days,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  adIds: string[];
  days: number;
  onPick: (offer: OfferSuggestion) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <OfferBody userId={userId} adIds={adIds} days={days} onPick={onPick} /> : null}
    </Dialog>
  );
}

function OfferBody({
  userId,
  adIds,
  days,
  onPick,
}: {
  userId: string;
  adIds: string[];
  days: number;
  onPick: (offer: OfferSuggestion) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const mutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/consultant-workspace/offer-suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, adIds, days }),
      });
      const body = (await response.json().catch(() => null)) as (OfferSuggestionResult & { error?: string }) | null;
      if (!response.ok || !body?.suggestions) throw new Error(body?.error ?? "Falha ao sugerir ofertas");
      return body;
    },
  });
  const { mutate, isPending } = mutation;
  // Cada pedido é uma chamada paga: uma só ao abrir, mesmo com o efeito duplo do modo estrito.
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    mutate();
  }, [mutate]);

  useEffect(() => {
    if (!isPending) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [isPending]);

  const data = mutation.data;
  return (
    <DialogContent className="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Lightbulb className="size-4 text-amber-500" /> Sugerir oferta/combo
        </DialogTitle>
        <DialogDescription>
          A IA lê o negócio, o texto do anúncio fraco, os anúncios que funcionam e o cardápio (se houver). Escolha uma
          opção: ela vira a mensagem da Mat, e você ainda edita antes de mandar.
        </DialogDescription>
      </DialogHeader>
      {isPending ? (
        <div className="space-y-2 py-4" aria-live="polite">
          <p className="flex items-center gap-2 text-sm">
            <Loader2 className="size-3.5 animate-spin text-amber-600" /> {STEPS[Math.min(STEPS.length - 1, Math.floor(elapsed / 5))]}
          </p>
          <p className="text-[11px] text-muted-foreground">Leva uns 15 segundos · {elapsed}s</p>
        </div>
      ) : mutation.isError ? (
        <div className="space-y-2 py-4 text-sm">
          <p className="text-red-700 dark:text-red-400">{mutation.error.message}</p>
          <Button size="sm" variant="outline" onClick={() => mutate()}>
            <RefreshCw className="size-3.5" /> Tentar de novo
          </Button>
        </div>
      ) : data ? (
        <div className="space-y-3">
          <div className="grid gap-2.5 md:grid-cols-3">
            {data.suggestions.map((offer, index) => (
              <div key={`${offer.name}-${index}`} className="flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card p-3">
                <p className="text-sm font-semibold leading-snug">{offer.name}</p>
                <p className="text-xs">{offer.composition}</p>
                {offer.priceHint ? <p className="text-xs text-muted-foreground">Preço: {offer.priceHint}</p> : null}
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Por quê:</span> {offer.whyItWorks}
                </p>
                {offer.creativeLine ? (
                  <p className="rounded bg-muted px-2 py-1 text-xs italic">“{offer.creativeLine}”</p>
                ) : null}
                <Button size="xs" className="mt-auto" onClick={() => onPick(offer)}>
                  Usar esta
                </Button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Base: {data.basedOn.badAds.length ? data.basedOn.badAds.map((ad) => `“${ad.name}”`).join(", ") : "o negócio"}
            {data.basedOn.bestAds.length ? ` vs. ${data.basedOn.bestAds.length} anúncio(s) que funcionam` : ""}
            {data.basedOn.menuItems
              ? ` · cardápio com ${data.basedOn.menuItems} itens${data.basedOn.menuHasPrices ? "" : " (sem preço)"}`
              : " · sem cardápio cadastrado — preços ficam para combinar com o cliente"}
            .
          </p>
          <Button size="xs" variant="ghost" onClick={() => mutate()}>
            <RefreshCw /> Gerar outras
          </Button>
        </div>
      ) : null}
    </DialogContent>
  );
}
