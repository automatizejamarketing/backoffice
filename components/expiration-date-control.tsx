"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calendar as CalendarIcon, Loader2 } from "lucide-react";
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
import { formatNumericDateInSaoPaulo } from "@/lib/backoffice/datetime-format";

interface ExpirationDateControlProps {
  userId: string;
  expirationDate: Date | string | null;
  variant?: "card" | "plain";
  onSaved?: () => void;
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
  variant = "card",
  onSaved,
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
    return formatNumericDateInSaoPaulo(date);
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
    if (expDate < now) return "Acesso expirado";
    return "Acesso ativo";
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
      onSaved?.();
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

  const getAccessSummary = (): string => {
    if (!expirationDate) return "Sem data definida";
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const expDate = new Date(expirationDate);
    expDate.setHours(0, 0, 0, 0);
    const days = Math.round(
      (expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (days < 0) {
      const ago = Math.abs(days);
      return ago === 1 ? "Expirado ontem" : `Expirado há ${ago} dias`;
    }
    if (days === 0) return "Expira hoje";
    if (days === 1) return "Expira amanhã";
    return `${days} dias restantes`;
  };

  const busy = isSaving || isPending;
  const adjustSteps = [
    { days: -30, label: "−30" },
    { days: -7, label: "−7" },
    { days: -1, label: "−1" },
    { days: 1, label: "+1" },
    { days: 7, label: "+7" },
    { days: 30, label: "+30" },
  ] as const;

  const controls = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "h-11 min-w-[12rem] justify-start px-3 text-left font-medium tabular-nums",
                !expirationDate && "text-muted-foreground",
              )}
              disabled={busy}
            >
              <CalendarIcon className="size-4 text-muted-foreground" />
              {formatDate(expirationDate)}
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
        <div className="flex min-w-0 flex-col gap-0.5">
          <Badge variant={getBadgeVariant()} className="w-fit">
            {getBadgeLabel()}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {getAccessSummary()}
          </span>
        </div>
        {busy ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {isSaving ? "Salvando…" : "Atualizando…"}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Ajuste rápido</span>
        <div className="inline-flex overflow-hidden rounded-md border">
          {adjustSteps.map((step, index) => (
            <Button
              key={step.days}
              variant="ghost"
              size="sm"
              className={cn(
                "rounded-none px-2.5 tabular-nums",
                index > 0 && "border-l",
                step.days < 0
                  ? "text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  : "text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400",
              )}
              disabled={busy}
              onClick={() => requestAdjustDate(step.days)}
            >
              {step.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {variant === "card" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5" />
              Acesso à plataforma
            </CardTitle>
            <CardDescription>
              Até quando as áreas protegidas ficam liberadas
            </CardDescription>
          </CardHeader>
          <CardContent>{controls}</CardContent>
        </Card>
      ) : (
        controls
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) {
            setPendingNewDate(null);
          }
        }}
      >
        <AlertDialogContent className="z-[60]">
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
