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
import { StatusBadgeWithHint } from "@/components/status-badge";
import { getAccessBadgeProps } from "@/lib/subscriptions/derive";
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
import {
  expirationCalendarDate,
  expirationCalendarInput,
} from "@/lib/backoffice/expiration-date";

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
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setExpirationDate(normalizeDate(initialExpirationDate));
  }, [initialExpirationDate]);

  const formatDate = (date: Date | null): string => {
    if (!date) return "Sem data de expiração";
    return formatNumericDateInSaoPaulo(date);
  };

  const persistDate = async (newDate: Date): Promise<boolean> => {
    const dateString = expirationCalendarInput(newDate);

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
    setSaveError(
      response.status === 401
        ? "Sua sessão expirou. Entre novamente para alterar a data."
        : response.status === 403
          ? "Você não tem permissão para alterar a data de expiração."
          : "Não foi possível salvar a data de expiração. Tente novamente.",
    );
    return false;
  };

  const openConfirmation = (newDate: Date) => {
    setSaveError(null);
    setPendingNewDate(newDate);
    setConfirmOpen(true);
    setPickerOpen(false);
  };

  const handleConfirmChange = async () => {
    if (!pendingNewDate || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const ok = await persistDate(pendingNewDate);
      if (ok) {
        setConfirmOpen(false);
        setPendingNewDate(null);
      }
    } catch {
      setSaveError(
        "Não foi possível confirmar a alteração. Verifique sua conexão e tente novamente.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const requestAdjustDate = (days: number) => {
    const baseDate = expirationCalendarDate(expirationDate ?? new Date());
    const newDate = new Date(baseDate);
    newDate.setDate(newDate.getDate() + days);
    openConfirmation(newDate);
  };

  const handleCalendarSelect = (date: Date | undefined) => {
    if (!date) return;
    openConfirmation(date);
  };

  const busy = isSaving || isPending;
  const calendarDate = expirationDate
    ? expirationCalendarDate(expirationDate)
    : undefined;
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
              type="button"
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
              selected={calendarDate}
              defaultMonth={calendarDate}
              onSelect={(d) => handleCalendarSelect(d)}
              initialFocus
            />
          </PopoverContent>
        </Popover>
        <StatusBadgeWithHint badge={getAccessBadgeProps(expirationDate)} />
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
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "rounded-none px-2.5 tabular-nums",
                index > 0 && "border-l",
                step.days < 0
                  ? "text-destructive hover:bg-destructive/10"
                  : "text-success hover:bg-success/10",
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
          if (isSaving) return;
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
              {pendingNewDate
                ? formatNumericDateInSaoPaulo(expirationCalendarInput(pendingNewDate))
                : "—"}
            </span>
          </div>
          {saveError && (
            <p role="alert" className="text-sm text-destructive">
              {saveError}
            </p>
          )}
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
