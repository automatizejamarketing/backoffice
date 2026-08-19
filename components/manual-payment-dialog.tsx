"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Calendar as CalendarIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatDateInSaoPaulo,
  formatDateTimeInSaoPaulo,
} from "@/lib/backoffice/datetime-format";
import {
  parseManualPaymentDate,
  quoteManualPayment,
  todayYmdInSaoPaulo,
  type ManualPaymentQuoteError,
} from "@/lib/backoffice/manual-payment";
import type { PlanType } from "@/lib/db/schema";
import { PLAN_DEFINITIONS, PLAN_TYPES } from "@/lib/stripe/plans";
import { cn } from "@/lib/utils";

function ymdToLocalDate(ymd: string): Date {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function localDateToYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMoney(amountCentavos: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amountCentavos / 100);
}

function quoteErrorMessage(error: ManualPaymentQuoteError): string {
  switch (error) {
    case "invalid_plan":
      return "Plano inválido.";
    case "payment_date_in_future":
      return "A data do pagamento não pode ser no futuro.";
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}

export function ManualPaymentDialog({
  userId,
  currentPlanType,
  currentExpiration,
  disabledReason,
}: {
  userId: string;
  currentPlanType?: PlanType | null;
  currentExpiration: Date | string | null;
  disabledReason?: string | null;
}) {
  const router = useRouter();
  const defaultPlan = currentPlanType ?? "monthly_starter";
  const [open, setOpen] = useState(false);
  const [planType, setPlanType] = useState<PlanType>(defaultPlan);
  const [paidOn, setPaidOn] = useState(todayYmdInSaoPaulo);
  const [transactionId, setTransactionId] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPlanType(currentPlanType ?? "monthly_starter");
    setPaidOn(todayYmdInSaoPaulo());
    setTransactionId("");
    setCalendarOpen(false);
  }, [open, currentPlanType]);

  const expirationDate = useMemo(
    () => toDateOrNull(currentExpiration),
    [currentExpiration],
  );
  const todayYmd = todayYmdInSaoPaulo();
  const paidAt = useMemo(() => parseManualPaymentDate(paidOn), [paidOn]);
  const quote = useMemo(() => {
    return quoteManualPayment({
      planType,
      paidAt,
      currentExpiration: expirationDate,
    });
  }, [planType, paidAt, expirationDate]);
  const extendsFromCurrentExpiration = Boolean(
    expirationDate && !Number.isNaN(paidAt.getTime()) && expirationDate > paidAt,
  );

  async function handleConfirm() {
    if (!quote.ok || submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/subscriptions/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record_manual_payment",
          planType,
          paidOn,
          transactionId: transactionId.trim() || undefined,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        newExpiration?: string;
      };

      if (!response.ok) {
        toast.error("Não foi possível registrar o pagamento manual.", {
          description: data.message ?? data.error ?? "Tente novamente.",
        });
        return;
      }

      toast.success("Pagamento manual registrado", {
        description: `${PLAN_DEFINITIONS[planType].name} · ${quote.credits} créditos · nova expiração ${formatDateInSaoPaulo(data.newExpiration ?? quote.newExpiration)}`,
      });
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Não foi possível registrar o pagamento manual.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={!!disabledReason}
        onClick={() => setOpen(true)}
      >
        <Banknote className="size-4" />
        Registrar pagamento manual
      </Button>
      {disabledReason && (
        <p className="text-sm text-muted-foreground">{disabledReason}</p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar pagamento manual</DialogTitle>
            <DialogDescription>
              Registra uma transferência bancária como evento de cobrança, com
              créditos e nova data de expiração.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="manual-payment-plan">Plano</Label>
              <Select
                value={planType}
                onValueChange={(value) => setPlanType(value as PlanType)}
                disabled={submitting}
              >
                <SelectTrigger id="manual-payment-plan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_TYPES.map((plan) => (
                    <SelectItem key={plan} value={plan}>
                      {PLAN_DEFINITIONS[plan].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Data do pagamento</Label>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={submitting}
                    className={cn(
                      "justify-start text-left font-normal",
                      !paidOn && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="size-4" />
                    {formatDateInSaoPaulo(paidAt)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={ymdToLocalDate(paidOn)}
                    onSelect={(date) => {
                      if (!date) return;
                      setPaidOn(localDateToYmd(date));
                      setCalendarOpen(false);
                    }}
                    disabled={{ after: ymdToLocalDate(todayYmd) }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="manual-payment-transaction">
                ID da transação (opcional)
              </Label>
              <Input
                id="manual-payment-transaction"
                value={transactionId}
                onChange={(event) => setTransactionId(event.target.value)}
                placeholder="B336KCNVEJW046Z9H"
                disabled={submitting}
              />
            </div>

            <div className="rounded-md border bg-muted/40 p-4">
              <p className="text-sm font-medium">Pré-visualização</p>
              {quote.ok ? (
                <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Plano</dt>
                    <dd className="font-medium">
                      {PLAN_DEFINITIONS[planType].name}
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Valor</dt>
                    <dd className="font-medium">
                      {formatMoney(quote.amountCentavos)}
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">
                      Créditos a conceder
                    </dt>
                    <dd className="font-medium">{quote.credits}</dd>
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">
                      Expiração atual
                    </dt>
                    <dd className="font-medium">
                      {formatDateInSaoPaulo(expirationDate)}
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5 sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">
                      Nova expiração
                    </dt>
                    <dd className="font-medium">
                      {formatDateTimeInSaoPaulo(quote.newExpiration)}
                    </dd>
                  </div>
                  {extendsFromCurrentExpiration ? (
                    <p className="text-sm text-muted-foreground sm:col-span-2">
                      A expiração atual já é posterior à data do pagamento. O
                      novo vencimento soma o plano a partir de{" "}
                      {formatDateInSaoPaulo(expirationDate)}, não da data do
                      pagamento.
                    </p>
                  ) : null}
                </dl>
              ) : (
                <p className="mt-2 text-sm text-destructive">
                  {quoteErrorMessage(quote.error)}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={!quote.ok || submitting}
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Confirmar registro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
