"use client";
import { useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getWhatsAppUrl } from "@/lib/phone";
import type { PlanType } from "@/lib/db/schema";
import type { pixAutomaticLink } from "@/lib/backoffice/pix-automatic-link";

export function PixPaymentMode({ value, onChange, disabled }: { value: "automatic" | "single"; onChange: (value: "automatic" | "single") => void; disabled?: boolean }) {
  return <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de Pix">
    <Button type="button" variant={value === "automatic" ? "default" : "outline"} aria-pressed={value === "automatic"} disabled={disabled} onClick={() => onChange("automatic")}>Pix Automático</Button>
    <Button type="button" variant={value === "single" ? "default" : "outline"} aria-pressed={value === "single"} disabled={disabled} onClick={() => onChange("single")}>Pix pontual</Button>
  </div>;
}

export function PixAutomaticLink({ userId, planType, userPhone, disabledReason }: { userId: string; planType: PlanType; userPhone?: string | null; disabledReason?: string | null }) {
  const [link, setLink] = useState<ReturnType<typeof pixAutomaticLink> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function generate() {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/users/${userId}/pix-automatic-link?plan=${encodeURIComponent(planType)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível gerar o link.");
      setLink(result);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível gerar o link."); }
    finally { setLoading(false); }
  }
  const message = link ? `Olá! Ative o Pix Automático do plano ${link.planName}: ${link.price}.\n\nAcesse sua conta, confira as condições e informe CPF/CNPJ para autorizar no banco. O primeiro pagamento é na hora, sem teste grátis. As próximas cobranças serão automáticas.\n\n${link.url}` : "";
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">O cliente entra na própria conta, informa CPF/CNPJ e autoriza no banco. O primeiro período é pago na hora; os próximos são debitados automaticamente. Gerar este link não cria uma cobrança.</p>
    <p className="text-sm text-muted-foreground">Pix Automático não tem teste grátis. Os dias de acesso já pagos são preservados.</p>
    {disabledReason ? <p className="text-sm text-muted-foreground">{disabledReason}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {link ? <>
      <p className="text-sm font-medium">{link.planName} · {link.price}</p>
      <input aria-label="Link do Pix Automático" readOnly value={link.url} onFocus={e => e.currentTarget.select()} className="w-full rounded-md border bg-muted/40 px-3 py-2 text-sm" />
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={async () => { try { await navigator.clipboard.writeText(link.url); toast.success("Link copiado"); } catch { toast.error("Selecione e copie o link acima."); } }}><Copy className="size-4" />Copiar link</Button>
        {userPhone ? <Button variant="outline" asChild><a href={getWhatsAppUrl(userPhone, message) ?? undefined} target="_blank" rel="noopener noreferrer">Enviar no WhatsApp</a></Button> : null}
      </div>
    </> : <Button type="button" disabled={loading || !!disabledReason} onClick={() => void generate()}>{loading ? <Loader2 className="size-4 animate-spin" /> : null}Gerar link do Pix Automático</Button>}
  </div>;
}
