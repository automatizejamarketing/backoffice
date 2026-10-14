"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL, planCovers } from "@/lib/agency/plan-core";

const STATUS_LABEL: Record<string, string> = {
  none: "Sem plano",
  pending: "Aguardando pagamento",
  active: "Ativo",
  past_due: "Pagamento atrasado",
  canceled: "Cancelado",
};

export type AgencyPlanView = { status: string; clientLimit: number; unitAmountCents: number | null; paidUntil: string | null };

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const centsToInput = (cents: number | null) => (cents ? (cents / 100).toFixed(2).replace(".", ",") : "");

/** Plano da Agência: o admin define preço por cliente e quantidade; o Dono paga pelo Stripe. */
export function AgencyPlan({ agencyId, plan, clientCount, canEdit, justPaid }: { agencyId: string; plan: AgencyPlanView; clientCount: number; canEdit: boolean; justPaid: boolean }) {
  const router = useRouter();
  const [price, setPrice] = useState(centsToInput(plan.unitAmountCents));
  const [limit, setLimit] = useState(plan.clientLimit ? String(plan.clientLimit) : "");
  const [busy, setBusy] = useState<"save" | "pay" | null>(null);
  const paidUntil = plan.paidUntil ? new Date(plan.paidUntil) : null;
  const covered = planCovers(paidUntil);
  const canPay = Boolean(plan.unitAmountCents) && plan.clientLimit > 0 && plan.status !== "active";

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    try {
      const response = await fetch(`/api/agencies/${agencyId}/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitAmount: price, clientLimit: limit }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar o plano.");
      toast.success(plan.status === "active" || plan.status === "past_due" ? "Plano atualizado no Stripe. A diferença entra na próxima fatura." : "Plano salvo. O Dono já pode pagar.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o plano.");
    } finally {
      setBusy(null);
    }
  }

  async function pay() {
    setBusy("pay");
    try {
      const response = await fetch(`/api/agencies/${agencyId}/plan`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error ?? "Não foi possível abrir o pagamento.");
      window.location.assign(data.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível abrir o pagamento.");
      setBusy(null);
    }
  }

  const total = plan.unitAmountCents ? plan.unitAmountCents * plan.clientLimit : null;

  return (
    <section className="space-y-3" aria-labelledby="agency-plan">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="agency-plan" className="text-lg font-semibold">Plano</h2>
        <Badge variant={covered ? "secondary" : "outline"}>{STATUS_LABEL[plan.status] ?? plan.status}</Badge>
      </div>
      <div className="space-y-3 rounded-lg border bg-card p-4">
        {plan.unitAmountCents && plan.clientLimit ? (
          <div className="space-y-1 text-sm">
            <p>
              <span className="tabular-nums">{clientCount}</span> de <span className="tabular-nums">{plan.clientLimit}</span> clientes ·{" "}
              <span className="tabular-nums">{formatBRL(plan.unitAmountCents)}</span> por cliente ·{" "}
              <span className="font-medium tabular-nums">{formatBRL(total!)}</span> por mês
            </p>
            <p className="text-muted-foreground">
              {paidUntil
                ? covered
                  ? `Pago até ${formatDate(plan.paidUntil!)}. As contas dos clientes têm acesso enquanto o plano estiver pago.`
                  : `O último período pago terminou em ${formatDate(plan.paidUntil!)}. A postagem pelo ClickUp está parada.`
                : "Ainda não pago. As contas dos clientes ganham acesso e a postagem pelo ClickUp liga quando o pagamento for aprovado."}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {canEdit ? "Defina o preço por cliente e quantos clientes o plano cobre." : "A Automatize ainda vai definir o plano da agência."}
          </p>
        )}
        {justPaid && !covered ? <p className="text-sm text-muted-foreground">Pagamento enviado. O plano é ativado assim que o Stripe confirmar; atualize a página em instantes.</p> : null}
        {canPay ? (
          <Button type="button" onClick={pay} disabled={busy === "pay"}>
            {busy === "pay" ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
            {plan.status === "past_due" ? "Pagar fatura em atraso" : "Pagar plano"}
          </Button>
        ) : null}
        {canEdit ? (
          <form className="grid min-w-0 gap-3 border-t pt-3 md:grid-cols-[180px_140px_auto] md:items-end" onSubmit={save}>
            <div className="space-y-1.5">
              <Label htmlFor="plan-price">Preço por cliente (R$/mês)</Label>
              <Input id="plan-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="149,90" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-limit">Clientes</Label>
              <Input id="plan-limit" type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="4" required />
            </div>
            <Button type="submit" variant="outline" disabled={busy === "save"}>
              {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null}
              Salvar plano
            </Button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
