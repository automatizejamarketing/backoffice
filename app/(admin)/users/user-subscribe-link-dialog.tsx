"use client";

import { SubscribeLinkActions } from "@/components/subscribe-link-actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function UserSubscribeLinkDialog({
  open,
  onOpenChange,
  userId,
  userEmail,
  userPhone,
  disabledReason,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userEmail: string;
  userPhone?: string | null;
  disabledReason?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link de assinatura</DialogTitle>
          <DialogDescription>
            Link público de pagamento para {userEmail} escolher um plano e
            assinar pela Vindi.
          </DialogDescription>
        </DialogHeader>
        <SubscribeLinkActions
          userId={userId}
          userEmail={userEmail}
          userPhone={userPhone}
          disabledReason={disabledReason}
        />
      </DialogContent>
    </Dialog>
  );
}
