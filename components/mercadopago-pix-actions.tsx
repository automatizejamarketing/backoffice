"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Mail, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PLAN_DEFINITIONS, PLAN_TYPES } from "@/lib/stripe/plans";
import type { PlanType } from "@/lib/db/schema";

export type PixLinkView = {
  id: string;
  planType: PlanType;
  amount: number;
  currency: string;
  preferenceId: string;
  initPoint: string;
  status: string;
  source: string;
  adminEmail: string | null;
  expiresAt: string;
  createdAt: string;
};

function formatMoney(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function MercadoPagoPixActions({
  userId,
  currentPlanType,
  initialLinks,
  disabledReason,
}: {
  userId: string;
  currentPlanType?: PlanType | null;
  initialLinks: PixLinkView[];
  disabledReason?: string | null;
}) {
  const router = useRouter();
  const [planType, setPlanType] = useState<PlanType>(
    currentPlanType ?? "monthly_pro",
  );
  const [links, setLinks] = useState<PixLinkView[]>(initialLinks);
  const [loadingMode, setLoadingMode] = useState<"copy" | "email" | null>(null);

  const latestPending = useMemo(
    () => links.find((link) => link.status === "pending") ?? null,
    [links],
  );

  async function createLink(sendEmail: boolean) {
    setLoadingMode(sendEmail ? "email" : "copy");
    try {
      const response = await fetch(`/api/users/${userId}/mercadopago-pix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planType, sendEmail }),
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error ?? "Falha ao gerar link Pix");
      }

      const link = json.link as PixLinkView;
      setLinks((prev) => [link, ...prev.filter((item) => item.id !== link.id)]);
      router.refresh();

      if (sendEmail) {
        toast.success(json.reused ? "Link Pix reenviado" : "Link Pix enviado");
      } else {
        await navigator.clipboard.writeText(link.initPoint);
        toast.success(
          json.reused ? "Link Pix copiado" : "Link Pix criado e copiado",
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível gerar o Pix",
      );
    } finally {
      setLoadingMode(null);
    }
  }

  async function copyExisting(link: PixLinkView) {
    await navigator.clipboard.writeText(link.initPoint);
    toast.success("Link Pix copiado");
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <Select
          value={planType}
          onValueChange={(value) => setPlanType(value as PlanType)}
          disabled={!!disabledReason || loadingMode !== null}
        >
          <SelectTrigger>
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
        <Button
          variant="outline"
          onClick={() => createLink(false)}
          disabled={!!disabledReason || loadingMode !== null}
        >
          {loadingMode === "copy" ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Copy className="mr-2 size-4" />
          )}
          Gerar/copiar
        </Button>
        <Button
          onClick={() => createLink(true)}
          disabled={!!disabledReason || loadingMode !== null}
        >
          {loadingMode === "email" ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Mail className="mr-2 size-4" />
          )}
          Enviar email
        </Button>
      </div>

      {disabledReason && (
        <p className="text-sm text-muted-foreground">{disabledReason}</p>
      )}

      {latestPending && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <QrCode className="size-4 text-primary" />
            <span className="font-medium">
              {PLAN_DEFINITIONS[latestPending.planType].name}
            </span>
            <Badge variant="secondary">{latestPending.status}</Badge>
            <span className="text-muted-foreground">
              {formatMoney(latestPending.amount, latestPending.currency)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>vence {formatDateTime(latestPending.expiresAt)}</span>
            <span className="font-mono">{latestPending.preferenceId}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => copyExisting(latestPending)}
            >
              <Copy className="mr-1 size-3" />
              Copiar
            </Button>
          </div>
        </div>
      )}

      {links.length > 0 && (
        <div className="space-y-2">
          {links.slice(0, 5).map((link) => (
            <div
              key={link.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {PLAN_DEFINITIONS[link.planType].name} ·{" "}
                  {formatMoney(link.amount, link.currency)}
                </p>
                <p className="truncate text-muted-foreground">
                  {link.source} · {formatDateTime(link.createdAt)} ·{" "}
                  {link.preferenceId}
                </p>
              </div>
              <Badge
                variant={link.status === "pending" ? "default" : "outline"}
              >
                {link.status}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
