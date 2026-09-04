"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CalendarClock,
  ContactRound,
  Copy,
  CreditCard,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Phone,
  PhoneOff,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import {
  persistUserContactMark,
  readUserContactMarks,
} from "@/lib/backoffice/user-contact-marks-client";
import type { ContactStatusFilter } from "@/lib/backoffice/users-filters";
import { UserContactDialog } from "./user-contact-dialog";
import type { ActiveSubscriptionSummary } from "@/lib/db/admin-queries";
import { getPixRenewalDisabledReason } from "@/lib/backoffice/pix-renewal-policy";
import {
  canCancelStripeSubscriptionAtPeriodEnd,
  getStripeCancellationExpirationDate,
} from "@/lib/backoffice/stripe-subscription-cancel-policy";
import { formatPlanLabel } from "@/lib/subscriptions/derive";
import { formatDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { ManualPaymentDialog } from "@/components/manual-payment-dialog";
import { AccountAccessSheet } from "@/components/account-access-sheet";
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
  userName,
  userPhone,
  expirationDate,
  activationAvailable,
  activeSubscription,
  canManageBilling,
  initiallyContacted,
  contactStatus,
  onActivated,
  onContactedChange,
  onSubscriptionUpdated,
}: {
  userId: string;
  userEmail: string;
  userName: string | null;
  userPhone?: string | null;
  expirationDate: Date | string | null;
  activationAvailable: boolean;
  activeSubscription: ActiveSubscriptionSummary;
  canManageBilling: boolean;
  initiallyContacted: boolean;
  contactStatus: ContactStatusFilter;
  onActivated: (emailVerified: string) => void;
  onContactedChange?: (contacted: boolean) => void;
  onSubscriptionUpdated?: (
    subscription: NonNullable<ActiveSubscriptionSummary>,
  ) => void;
}) {
  const router = useRouter();
  const [contactOpen, setContactOpen] = useState(false);
  const [contacted, setContacted] = useState(initiallyContacted);
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [isCancelingStripe, setIsCancelingStripe] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelStripeOpen, setCancelStripeOpen] = useState(false);
  const [pixDialogOpen, setPixDialogOpen] = useState(false);
  const [manualPaymentOpen, setManualPaymentOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [activationLink, setActivationLink] = useState<ActivationLink | null>(
    null,
  );
  const pixDisabledReason = getPixRenewalDisabledReason(activeSubscription);
  const stripeBlocksManualPayment = Boolean(pixDisabledReason);
  const manualPaymentDisabledReason = stripeBlocksManualPayment
    ? "Este usuário possui assinatura Stripe ativa."
    : null;
  const currentPlanType = activeSubscription?.planType ?? null;
  const canCancelStripe = canCancelStripeSubscriptionAtPeriodEnd(
    activeSubscription,
  );
  const stripeCancellationDate =
    getStripeCancellationExpirationDate(activeSubscription);

  useEffect(() => {
    setContacted(readUserContactMarks().includes(userId));
  }, [userId]);

  function toggleContacted(nextContacted: boolean) {
    persistUserContactMark(userId, nextContacted);
    setContacted(nextContacted);
    onContactedChange?.(nextContacted);
    toast.success(
      nextContacted
        ? "Marcado como contatado neste navegador"
        : "Contato desmarcado neste navegador",
    );
    if (contactStatus !== "all") {
      router.refresh();
    }
  }

  function formatCancellationDate(value: Date | null): string {
    if (!value) return "a data de expiração do período atual";
    return formatDateTimeInSaoPaulo(value);
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
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
            {userEmail}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setContactOpen(true)}>
            <ContactRound />
            Dados do contato
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => toggleContacted(!contacted)}>
            {contacted ? <PhoneOff /> : <Phone />}
            {contacted ? "Não entrei em contato" : "Já entrei em contato"}
          </DropdownMenuItem>
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
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAccessOpen(true)}>
            <CalendarClock />
            Alterar acesso
          </DropdownMenuItem>
          {canManageBilling ? (
            <>
              <DropdownMenuItem
                disabled={!!pixDisabledReason}
                onSelect={() => setPixDialogOpen(true)}
              >
                <QrCode />
                Gerar Pix para renovação
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={stripeBlocksManualPayment}
                onSelect={() => setManualPaymentOpen(true)}
              >
                <Banknote />
                Registrar pagamento manual
              </DropdownMenuItem>
              {pixDisabledReason ? (
                <p className="px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  Este usuário possui assinatura Stripe ativa.
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

      <AccountAccessSheet
        open={accessOpen}
        onOpenChange={setAccessOpen}
        userId={userId}
        userEmail={userEmail}
        expirationDate={expirationDate}
      />

      <UserContactDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        userName={userName}
        userEmail={userEmail}
        userPhone={userPhone}
        contacted={contacted}
        onToggleContacted={toggleContacted}
      />

      <UserPixRenewalDialog
        open={pixDialogOpen}
        onOpenChange={setPixDialogOpen}
        userId={userId}
        userEmail={userEmail}
        userPhone={userPhone}
        currentPlanType={currentPlanType}
        disabledReason={pixDisabledReason}
      />

      <ManualPaymentDialog
        open={manualPaymentOpen}
        onOpenChange={setManualPaymentOpen}
        showTrigger={false}
        userId={userId}
        userEmail={userEmail}
        currentPlanType={currentPlanType}
        currentExpiration={expirationDate}
        disabledReason={manualPaymentDisabledReason}
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
