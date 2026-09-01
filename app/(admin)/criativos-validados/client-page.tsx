"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type CreativeRow = {
  id: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  headline: string | null;
  body: string | null;
  category: string;
  subcategory: string;
  isActive: boolean;
  isPublished: boolean;
  firstSeenAt: Date;
  advertiserName: string;
  instagramHandle: string | null;
  state: string | null;
  city: string | null;
  score: number | null;
  productRelevanceScore: number | null;
  creativeStrengthScore: number | null;
  advertiserContinuityScore: number | null;
  creativeType: string | null;
};

export function CriativosValidadosClient({
  initialData,
}: {
  initialData: CreativeRow[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<CreativeRow[]>(initialData);
  const [filter, setFilter] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [isRefreshing, startRefreshTransition] = useTransition();

  useEffect(() => {
    setItems(initialData);
  }, [initialData]);

  const filteredItems = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const haystack = [
        item.advertiserName,
        item.instagramHandle ?? "",
        item.headline ?? "",
        item.body ?? "",
        item.category,
        item.subcategory,
        item.city ?? "",
        item.state ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, filter]);

  async function togglePublish(id: string, nextValue: boolean) {
    const previous = items;
    setPendingActionId(id);
    setItems((cur) =>
      cur.map((row) => (row.id === id ? { ...row, isPublished: nextValue } : row)),
    );

    try {
      const res = await fetch(`/api/backoffice/criativos-validados/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublished: nextValue }),
      });

      if (!res.ok) {
        setItems(previous);
        toast.error("Falha ao atualizar publicação do criativo.");
        return;
      }

      toast.success(nextValue ? "Criativo publicado." : "Criativo despublicado.");
    } catch {
      setItems(previous);
      toast.error("Falha ao atualizar publicação do criativo.");
    } finally {
      setPendingActionId((current) => (current === id ? null : current));
    }
  }

  async function deleteCreative(id: string) {
    const confirmed = window.confirm(
      "Tem certeza que deseja apagar este criativo validado?",
    );
    if (!confirmed) return;

    const previous = items;
    setPendingActionId(id);
    setItems((cur) => cur.filter((row) => row.id !== id));

    try {
      const res = await fetch(`/api/backoffice/criativos-validados/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        setItems(previous);
        toast.error("Falha ao apagar o criativo.");
        return;
      }

      toast.success("Criativo apagado.");
      startRefreshTransition(() => {
        router.refresh();
      });
    } catch {
      setItems(previous);
      toast.error("Falha ao apagar o criativo.");
    } finally {
      setPendingActionId((current) => (current === id ? null : current));
    }
  }

  async function syncPreset() {
    setIsSyncing(true);
    try {
      const res = await fetch("/api/backoffice/apify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset: "FOOD_BEST_CREATIVES", limit: 200 }),
      });

      if (!res.ok) {
        toast.error("Falha ao sincronizar via Apify.");
        return;
      }

      toast.success("Sincronização concluída. Atualizando lista...");
      startRefreshTransition(() => {
        router.refresh();
      });
    } catch {
      toast.error("Falha ao sincronizar via Apify.");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar por anunciante, texto, categoria..."
            className="w-full sm:w-[420px]"
          />
        </div>
        <div className="flex gap-2">
          <Button
            onClick={syncPreset}
            variant="secondary"
            disabled={isSyncing || isRefreshing}
          >
            {isSyncing || isRefreshing
              ? "Sincronizando..."
              : "Sincronizar (Apify)"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {filteredItems.map((item) => (
          <div
            key={item.id}
            className="rounded-lg border bg-card p-4 text-card-foreground"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium">{item.advertiserName}</div>
                  {item.instagramHandle ? (
                    <div className="text-muted-foreground text-sm">
                      @{item.instagramHandle}
                    </div>
                  ) : null}
                  <div className="text-muted-foreground text-sm">
                    {item.category} / {item.subcategory}
                  </div>
                </div>
                {item.headline ? (
                  <div className="mt-2 line-clamp-2 text-sm">{item.headline}</div>
                ) : null}
                {item.body ? (
                  <div className="mt-2 line-clamp-3 text-muted-foreground text-sm">
                    {item.body}
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <div>
                    Score:{" "}
                    {[
                      item.productRelevanceScore,
                      item.creativeStrengthScore,
                      item.advertiserContinuityScore,
                    ]
                      .filter((v) => typeof v === "number")
                      .join(" / ") || "-"}
                  </div>
                  <div>Tipo: {item.creativeType ?? "-"}</div>
                  <div>Ativo: {item.isActive ? "sim" : "não"}</div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="text-sm">Publicar</div>
                  <Switch
                    checked={item.isPublished}
                    onCheckedChange={(checked) => togglePublish(item.id, checked)}
                    disabled={pendingActionId === item.id}
                  />
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={pendingActionId === item.id}
                  onClick={() => deleteCreative(item.id)}
                >
                  {pendingActionId === item.id ? "Processando..." : "Apagar"}
                </Button>
                {item.videoUrl ? (
                  <a
                    href={item.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm underline"
                  >
                    Ver vídeo
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        ))}

        {filteredItems.length === 0 ? (
          <div className="rounded-lg border bg-card p-6 text-center text-muted-foreground">
            Nenhum criativo encontrado.
          </div>
        ) : null}
      </div>
    </div>
  );
}
