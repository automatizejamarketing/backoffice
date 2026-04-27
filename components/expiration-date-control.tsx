"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calendar as CalendarIcon, Loader2, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface ExpirationDateControlProps {
  userId: string;
  expirationDate: Date | string | null;
}

function normalizeDate(date: Date | string | null): Date | null {
  if (!date) return null;
  if (date instanceof Date) return date;
  return new Date(date);
}

/** Calendar day in local time as YYYY-MM-DD (avoids UTC date shift from toISOString). */
function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ExpirationDateControl({
  userId,
  expirationDate: initialExpirationDate,
}: ExpirationDateControlProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expirationDate, setExpirationDate] = useState<Date | null>(() =>
    normalizeDate(initialExpirationDate),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingNewDate, setPendingNewDate] = useState<Date | null>(null);

  useEffect(() => {
    setExpirationDate(normalizeDate(initialExpirationDate));
  }, [initialExpirationDate]);

  const formatDate = (date: Date | null): string => {
    if (!date) return "Sem data de expiração";
    return new Date(date).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const getBadgeVariant = (): "default" | "destructive" | "secondary" => {
    if (!expirationDate) return "secondary";
    const now = new Date();
    const expDate = new Date(expirationDate);
    expDate.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    if (expDate < now) return "destructive";
    return "default";
  };

  const getBadgeLabel = (): string => {
    if (!expirationDate) return "Não definido";
    const now = new Date();
    const expDate = new Date(expirationDate);
    expDate.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    if (expDate < now) return "Expirado";
    return "Ativo";
  };

  const persistDate = async (newDate: Date): Promise<boolean> => {
    const dateString = formatLocalYmd(new Date(newDate));

    const response = await fetch(`/api/users/${userId}/expiration`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expirationDate: dateString }),
    });

    if (response.ok) {
      const result = await response.json();
      setExpirationDate(new Date(result.expirationDate));
      setPickerOpen(false);
      startTransition(() => {
        router.refresh();
      });
      return true;
    }
    console.error("Failed to update expiration date");
    return false;
  };

  const openConfirmation = (newDate: Date) => {
    setPendingNewDate(newDate);
    setConfirmOpen(true);
    setPickerOpen(false);
  };

  const handleConfirmChange = async () => {
    if (!pendingNewDate) return;
    setIsSaving(true);
    try {
      const ok = await persistDate(pendingNewDate);
      if (ok) {
        setConfirmOpen(false);
        setPendingNewDate(null);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const requestAdjustDate = (days: number) => {
    const baseDate = expirationDate ? new Date(expirationDate) : new Date();
    baseDate.setHours(0, 0, 0, 0);
    const newDate = new Date(baseDate);
    newDate.setDate(newDate.getDate() + days);
    openConfirmation(newDate);
  };

  const handleCalendarSelect = (date: Date | undefined) => {
    if (!date) return;
    openConfirmation(date);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Data de Expiração
          </CardTitle>
          <CardDescription>
            Ajuste a data de expiração do acesso do usuário
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Data atual:</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{formatDate(expirationDate)}</span>
                <Badge variant={getBadgeVariant()}>{getBadgeLabel()}</Badge>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground shrink-0">
                Escolher data:
              </span>
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "justify-start text-left font-normal",
                      !expirationDate && "text-muted-foreground",
                    )}
                    disabled={isSaving || isPending}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {expirationDate
                      ? formatDate(expirationDate)
                      : "Selecionar no calendário"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={expirationDate ?? undefined}
                    onSelect={(d) => handleCalendarSelect(d)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground flex-1 min-w-[80px]">
                  Aumentar:
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => requestAdjustDate(1)}
                    disabled={isSaving || isPending}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    +1 dia
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => requestAdjustDate(7)}
                    disabled={isSaving || isPending}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    +7 dias
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => requestAdjustDate(30)}
                    disabled={isSaving || isPending}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    +30 dias
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground flex-1 min-w-[80px]">
                  Diminuir:
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => requestAdjustDate(-1)}
                    disabled={isSaving || isPending}
                  >
                    <Minus className="h-3 w-3 mr-1" />
                    -1 dia
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => requestAdjustDate(-7)}
                    disabled={isSaving || isPending}
                  >
                    <Minus className="h-3 w-3 mr-1" />
                    -7 dias
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => requestAdjustDate(-30)}
                    disabled={isSaving || isPending}
                  >
                    <Minus className="h-3 w-3 mr-1" />
                    -30 dias
                  </Button>
                </div>
              </div>
            </div>

            {(isSaving || isPending) && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {isSaving ? "Salvando..." : "Atualizando..."}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) {
            setPendingNewDate(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar alteração da data</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja alterar a data de expiração deste usuário? A alteração será
              registrada no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">De </span>
            <span className="font-medium text-foreground">
              {formatDate(expirationDate)}
            </span>
            <span className="text-muted-foreground"> para </span>
            <span className="font-medium text-foreground">
              {pendingNewDate ? formatDate(pendingNewDate) : "—"}
            </span>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving || isPending}>
              Cancelar
            </AlertDialogCancel>
            <Button
              type="button"
              onClick={() => void handleConfirmChange()}
              disabled={isSaving || isPending}
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando…
                </>
              ) : (
                "Confirmar"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
