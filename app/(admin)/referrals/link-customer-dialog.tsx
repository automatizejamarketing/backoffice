"use client";

// Vincular manualmente um cliente existente como Indicado deste afiliado
// (spec 2026-10-11, R2–R5). A prévia só informa a BASE do que o motor de
// comissão vai processar; quem decide é o POST, que relê tudo no servidor.

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  describeAgreementDuration,
  describeAgreementValue,
} from "@/lib/referral/agreement";
import {
  describeManualLinkCharges,
  describeManualLinkQuota,
  MANUAL_LINK_REASON_MAX_LENGTH,
} from "@/lib/referral/manual-link";
import type { ManualLinkPreview } from "@/lib/referral/manual-link-queries";

type SearchUser = { id: string; email: string; name: string | null };

const PREVIEW_ERROR = "Não foi possível carregar a prévia.";
const SUBMIT_ERROR = "Não foi possível vincular o indicado.";

export function LinkCustomerDialog({
  affiliate,
  open,
  onOpenChange,
  onLinked,
}: {
  affiliate: { id: string; label: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [selected, setSelected] = useState<SearchUser | null>(null);
  const [preview, setPreview] = useState<ManualLinkPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Cada busca e cada prévia leva um número; resposta de um número antigo é
  // descartada. Sem isso, digitar rápido mostra o resultado de uma busca velha.
  const searchSeq = useRef(0);
  const previewSeq = useRef(0);

  const reset = () => {
    searchSeq.current += 1;
    previewSeq.current += 1;
    setQuery("");
    setResults([]);
    setSelected(null);
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setReason("");
    setSubmitError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const search = async (value: string) => {
    setQuery(value);
    // Editar a busca desfaz a escolha: nunca vincular alguém que não está na tela.
    previewSeq.current += 1;
    setSelected(null);
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setSubmitError(null);
    const seq = ++searchSeq.current;
    const term = value.trim();
    if (term.length < 3) {
      setResults([]);
      return;
    }
    try {
      const response = await fetch(`/api/users/search?q=${encodeURIComponent(term)}`);
      if (!response.ok) throw new Error(String(response.status));
      const rows = (await response.json()) as SearchUser[];
      if (seq !== searchSeq.current) return;
      setResults(rows.map((row) => ({ id: row.id, email: row.email, name: row.name })));
    } catch {
      if (seq === searchSeq.current) setResults([]);
    }
  };

  const choose = async (candidate: SearchUser) => {
    searchSeq.current += 1;
    setSelected(candidate);
    setQuery(candidate.email);
    setResults([]);
    setPreview(null);
    setPreviewError(null);
    setSubmitError(null);
    const seq = ++previewSeq.current;
    setPreviewLoading(true);
    try {
      const response = await fetch(
        `/api/referrals/${affiliate.id}/customers/preview?userId=${encodeURIComponent(candidate.id)}`,
      );
      const payload = (await response.json().catch(() => ({}))) as
        | ManualLinkPreview
        | { error?: string };
      if (seq !== previewSeq.current) return;
      if (!response.ok) {
        setPreviewError(("error" in payload && payload.error) || PREVIEW_ERROR);
        return;
      }
      setPreview(payload as ManualLinkPreview);
    } catch {
      if (seq === previewSeq.current) setPreviewError(PREVIEW_ERROR);
    } finally {
      if (seq === previewSeq.current) setPreviewLoading(false);
    }
  };

  const trimmedReason = reason.trim();
  const canSubmit =
    selected !== null &&
    preview !== null &&
    preview.blocked === null &&
    !previewLoading &&
    trimmedReason.length > 0 &&
    trimmedReason.length <= MANUAL_LINK_REASON_MAX_LENGTH &&
    !submitting;

  const submit = async () => {
    if (!selected || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch(`/api/referrals/${affiliate.id}/customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selected.id, reason: trimmedReason }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setSubmitError(payload.error || SUBMIT_ERROR);
        return;
      }
      toast.success("Indicado vinculado", {
        description: "As cobranças pagas dele entram no cálculo da comissão em até 1 hora.",
      });
      reset();
      onOpenChange(false);
      onLinked();
    } catch {
      setSubmitError(SUBMIT_ERROR);
    } finally {
      setSubmitting(false);
    }
  };

  const quotaWarning =
    preview?.agreement && preview.blocked === null
      ? describeManualLinkQuota(preview.agreement, preview.charges.eligibleCount)
      : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Vincular indicado</DialogTitle>
          <DialogDescription>
            Liga um cliente que já existe a {affiliate.label}. As cobranças pagas dele —
            inclusive as passadas — passam a gerar comissão pela regra do acordo.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-2">
          <Label htmlFor="link-customer-search">Cliente</Label>
          <Input
            id="link-customer-search"
            data-testid="link-customer-search"
            placeholder="Buscar por e-mail (mínimo 3 letras)"
            autoComplete="off"
            value={query}
            onChange={(event) => void search(event.target.value)}
          />
          {results.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-md border">
              {results.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  data-testid="link-customer-result"
                  className="flex w-full min-w-0 flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => void choose(candidate)}
                >
                  <span className="w-full truncate font-medium">{candidate.name || "—"}</span>
                  <span className="w-full truncate text-xs text-muted-foreground">
                    {candidate.email}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <div
            className="min-w-0 rounded-md border p-3 text-sm"
            data-testid="link-customer-preview"
          >
            {previewLoading ? (
              <p className="text-muted-foreground">Carregando a prévia…</p>
            ) : previewError ? (
              <p className="text-destructive">{previewError}</p>
            ) : preview?.blocked ? (
              <p className="text-destructive" data-testid="link-customer-blocked">
                {preview.blocked.message}
              </p>
            ) : preview ? (
              <div className="space-y-1">
                <p className="font-medium" data-testid="link-customer-charges">
                  {describeManualLinkCharges(preview.charges)}
                </p>
                {preview.agreement && (
                  <p className="text-xs text-muted-foreground">
                    Acordo: {describeAgreementValue(preview.agreement)} ·{" "}
                    {describeAgreementDuration(preview.agreement)}
                  </p>
                )}
                {quotaWarning && (
                  <p className="text-xs text-warning" data-testid="link-customer-quota">
                    {quotaWarning}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  O valor de cada comissão é calculado pelo motor do programa em até 1 hora
                  e aparece na coluna Comissão.
                </p>
              </div>
            ) : null}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="link-customer-reason">Motivo</Label>
          <Textarea
            id="link-customer-reason"
            data-testid="link-customer-reason"
            placeholder="Ex.: veio pelo afiliado por WhatsApp e se cadastrou sem o link"
            maxLength={MANUAL_LINK_REASON_MAX_LENGTH}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Obrigatório. Fica na auditoria com o seu e-mail.
          </p>
        </div>

        {submitError && (
          <p className="text-sm text-destructive" data-testid="link-customer-error">
            {submitError}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            data-testid="link-customer-submit"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
