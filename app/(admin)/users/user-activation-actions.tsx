"use client";

import { useState } from "react";
import {
  Copy,
  CreditCard,
  KeyRound,
  Loader2,
  MoreHorizontal,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import type { ActiveSubscriptionSummary } from "@/lib/db/admin-queries";
import { getPixRenewalDisabledReason } from "@/lib/backoffice/pix-renewal-policy";
import {
  canCancelStripeSubscriptionAtPeriodEnd,
  getStripeCancellationExpirationDate,
} from "@/lib/backoffice/stripe-subscription-cancel-policy";
import { formatPlanLabel } from "@/lib/subscriptions/derive";
import { UserPixRenewalDialog } from "./user-pix-renewal-dialog";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

type ActivationLink = {
  url: string;
  expiresAt: string;
};

export function UserActivationActions({
  userId,
  userEmail,
  userPhone,
  activationAvailable,
  activeSubscription,
  canManageBilling,
  onActivated,
  onSubscriptionUpdated,
}: {
  userId: string;
  userEmail: string;
  userPhone?: string | null;
  activationAvailable: boolean;
  activeSubscription: ActiveSubscriptionSummary;
  canManageBilling: boolean;
  onActivated: (emailVerified: string) => void;
  onSubscriptionUpdated?: (
    subscription: NonNullable<ActiveSubscriptionSummary>,
  ) => void;
}) {
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [isCancelingStripe, setIsCancelingStripe] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelStripeOpen, setCancelStripeOpen] = useState(false);
  const [pixDialogOpen, setPixDialogOpen] = useState(false);
  const [activationLink, setActivationLink] = useState<ActivationLink | null>(
    null,
  );
  const pixDisabledReason = getPixRenewalDisabledReason(activeSubscription);
  const currentPlanType = activeSubscription?.planType ?? null;
  const canCancelStripe = canCancelStripeSubscriptionAtPeriodEnd(
    activeSubscription,
  );
  const stripeCancellationDate =
    getStripeCancellationExpirationDate(activeSubscription);

  function formatCancellationDate(value: Date | null): string {
    if (!value) return "a data de expiração do período atual";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(value);
  }

  async function cancelStripeSubscription() {
    setIsCancelingStripe(true);
    try {
      const response = await fetch(`/api/subscriptions/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_stripe_subscription" }),
      });
      const json = (await response.json()) as {
        success?: boolean;
        cancelAtPeriodEnd?: boolean;
        message?: string;
        error?: string;
      };

      if (!response.ok || !json.success) {
        throw new Error(
          json.message ?? json.error ?? "Não foi possível cancelar a assinatura",
        );
      }

      if (activeSubscription) {
        onSubscriptionUpdated?.({
          ...activeSubscription,
          cancelAtPeriodEnd: true,
        });
      }

      setCancelStripeOpen(false);
      toast.success("Assinatura Stripe marcada para cancelar na expiração");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível cancelar a assinatura",
      );
    } finally {
      setIsCancelingStripe(false);
    }
  }

  async function createActivationLink() {
    setIsCreatingLink(true);
    try {
      const response = await fetch(`/api/users/${userId}/activation`, {
        method: "POST",
      });
      const data = (await response.json()) as {
        activationUrl?: string;
        expiresAt?: string;
        error?: string;
      };
      if (!response.ok || !data.activationUrl || !data.expiresAt) {
        throw new Error(data.error ?? "Não foi possível gerar o link");
      }
      setActivationLink({ url: data.activationUrl, expiresAt: data.expiresAt });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível gerar o link de ativação",
      );
    } finally {
      setIsCreatingLink(false);
    }
  }

  async function copyActivationLink() {
    if (!activationLink) return;
    try {
      await navigator.clipboard.writeText(activationLink.url);
      toast.success("Link de ativação copiado");
    } catch {
      toast.error("Não foi possível copiar. Selecione o link manualmente.");
    }
  }

  async function activateAccount() {
    setIsActivating(true);
    try {
      const response = await fetch(`/api/users/${userId}/activation`, {
        method: "PATCH",
      });
      const data = (await response.json()) as {
        emailVerified?: string;
        error?: string;
      };
      if (!response.ok || !data.emailVerified) {
        throw new Error(data.error ?? "Não foi possível ativar a conta");
      }
      onActivated(data.emailVerified);
      setConfirmOpen(false);
      toast.success("Conta ativada");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível ativar a conta",
      );
    } finally {
      setIsActivating(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Ações de ativação para ${userEmail}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
            {userEmail}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!activationAvailable || isCreatingLink}
            onSelect={() => void createActivationLink()}
          >
            {isCreatingLink ? (
              <Loader2 className="animate-spin" />
            ) : (
              <KeyRound />
            )}
            Pegar link de ativação
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!activationAvailable}
            onSelect={() => setConfirmOpen(true)}
          >
            <ShieldCheck />
            Ativar conta
          </DropdownMenuItem>
          {canManageBilling ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!!pixDisabledReason}
                onSelect={() => setPixDialogOpen(true)}
              >
                <QrCode />
                Gerar Pix para renovação
              </DropdownMenuItem>
              {pixDisabledReason ? (
                <p className="px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  {pixDisabledReason}
                </p>
              ) : null}
              {canCancelStripe ? (
                <DropdownMenuItem onSelect={() => setCancelStripeOpen(true)}>
                  <CreditCard />
                  Cancelar assinatura Stripe
                </DropdownMenuItem>
              ) : null}
              {activeSubscription?.provider === "stripe" &&
              activeSubscription.cancelAtPeriodEnd ? (
                <p className="px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  Assinatura Stripe já cancela em{" "}
                  {formatCancellationDate(stripeCancellationDate)}.
                </p>
              ) : null}
            </>
          ) : null}
          {!activationAvailable ? (
            <p className="px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Esta conta já está ativa ou usa acesso pelo Google.
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <UserPixRenewalDialog
        open={pixDialogOpen}
        onOpenChange={setPixDialogOpen}
        userId={userId}
        userEmail={userEmail}
        userPhone={userPhone}
        currentPlanType={currentPlanType}
        disabledReason={pixDisabledReason}
      />

      <Dialog
        open={Boolean(activationLink)}
        onOpenChange={(open) => {
          if (!open) setActivationLink(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Link de ativação</DialogTitle>
            <DialogDescription>
              Envie este link diretamente para {userEmail}. Ele expira em 24
              horas e só pode ser usado uma vez.
            </DialogDescription>
          </DialogHeader>
          <Input
            readOnly
            value={activationLink?.url ?? ""}
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono text-xs"
            aria-label="Link de ativação da conta"
          />
          <DialogFooter>
            <Button type="button" onClick={() => void copyActivationLink()}>
              <Copy className="size-4" />
              Copiar link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={cancelStripeOpen} onOpenChange={setCancelStripeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <CreditCard />
            </AlertDialogMedia>
            <AlertDialogTitle>
              Cancelar assinatura Stripe de {userEmail}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              A assinatura{" "}
              {activeSubscription
                ? formatPlanLabel(activeSubscription.planType)
                : "Stripe"}{" "}
              continuará ativa até{" "}
              <strong>
                {formatCancellationDate(stripeCancellationDate)}
              </strong>
              . Depois dessa data, o Stripe não fará novas cobranças.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelingStripe}>
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={isCancelingStripe}
              onClick={() => void cancelStripeSubscription()}
            >
              {isCancelingStripe ? <Loader2 className="animate-spin" /> : null}
              Cancelar na expiração
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <ShieldCheck />
            </AlertDialogMedia>
            <AlertDialogTitle>Ativar a conta de {userEmail}?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso marcará o email como verificado e liberará o login com a
              senha cadastrada. Faça isso somente após confirmar a identidade
              da pessoa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActivating}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={isActivating}
              onClick={() => void activateAccount()}
            >
              {isActivating ? <Loader2 className="animate-spin" /> : null}
              Ativar conta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
