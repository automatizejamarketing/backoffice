"use client";

// A fila de saques do programa v2 (ticket 11).
//
// O que esta tela existe para garantir:
//
//   * o operador vê o CPF/CNPJ **como estava no momento do pedido** — é ele que
//     precisa bater com o titular que o banco exibe na hora do Pix, e uma
//     alteração cadastral posterior não pode confundir o que foi pago;
//   * marcar como pago EXIGE o comprovante — é o que torna o repasse auditável
//     depois (história 48);
//   * cada decisão mostra quem decidiu e quando.
//
// O lançamento negativo no extrato do afiliado nasce só na transição para pago,
// no servidor. Aprovar não move dinheiro; negar não deixa rastro nenhum.
//
// A mesma tela carrega a BAIXA DE SALDO NEGATIVO (ticket 12), porque é o outro
// lado do mesmo problema: o estorno que chega depois do repasse deixa o
// afiliado devendo, e nenhum saque novo passa até zerar. A baixa é um
// lançamento compensatório com autor e motivo — nunca um `UPDATE` que faça a
// dívida sumir.

import { useCallback, useEffect, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CheckCircle,
  Loader2,
  Receipt,
  TrendingDown,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  formatTaxDocument,
  REFERRAL_PAYOUT_STATUS_LABELS,
} from "@/lib/referral/payout";
import {
  formatCentavos,
  parseReaisToCentavos,
  REFERRAL_WRITE_OFF_MIN_REASON_LENGTH,
} from "@/lib/referral/write-off";
import type { ReferralPayoutStatus } from "@/lib/db/schema";

type PayoutRow = {
  id: string;
  affiliateId: string;
  affiliateCode: string;
  amountCentavos: number;
  status: ReferralPayoutStatus;
  taxDocument: { document: string; type: "cpf" | "cnpj" };
  adminEmail: string | null;
  proofUrl: string | null;
  denialReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
  user: { id: string; email: string; name: string | null };
};

/** Um afiliado devendo — o saldo negativo que trava qualquer saque novo. */
type NegativeBalanceRow = {
  affiliateId: string;
  affiliateCode: string;
  affiliateStatus: string;
  releasedCentavos: number;
  blockedCentavos: number;
  availableCentavos: number;
  debtCentavos: number;
  user: { id: string; email: string; name: string | null };
};

const STATUS_BADGE: Record<
  ReferralPayoutStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  requested: "outline",
  approved: "secondary",
  paid: "default",
  denied: "destructive",
  cancelled: "outline",
};

/** O mesmo formatador da regra da baixa — dinheiro tem um jeito só nesta tela. */
const money = formatCentavos;

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

export default function ReferralPayoutsPage() {
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [payTarget, setPayTarget] = useState<PayoutRow | null>(null);
  // O comprovante é um ARQUIVO: o upload para o Blob acontece no registrar, e a
  // URL que ele devolve é a que o servidor grava — o operador nunca cola link.
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);

  const [denyTarget, setDenyTarget] = useState<PayoutRow | null>(null);
  const [denyReason, setDenyReason] = useState("");

  const [negatives, setNegatives] = useState<NegativeBalanceRow[]>([]);
  const [writeOffTarget, setWriteOffTarget] =
    useState<NegativeBalanceRow | null>(null);
  const [writeOffAmount, setWriteOffAmount] = useState("");
  const [writeOffReason, setWriteOffReason] = useState("");
  const [writingOff, setWritingOff] = useState(false);

  const fetchNegatives = useCallback(async () => {
    try {
      const response = await fetch("/api/referrals/negative-balances");
      const data = await response.json();
      setNegatives(data.balances ?? []);
    } catch {
      toast.error("Erro ao carregar os saldos negativos");
    }
  }, []);

  const fetchPayouts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const response = await fetch(`/api/referrals/payouts?${params}`);
      const data = await response.json();
      setPayouts(data.payouts ?? []);
      setTotals(data.totals ?? {});
    } catch {
      toast.error("Erro ao carregar os saques");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchPayouts();
  }, [fetchPayouts]);

  useEffect(() => {
    fetchNegatives();
  }, [fetchNegatives]);

  /**
   * Lança a baixa. O valor vai em CENTAVOS para o servidor: o campo aceita
   * reais porque é assim que o operador pensa, e a conversão é a mesma função
   * testada que a regra usa.
   */
  const submitWriteOff = async () => {
    if (!writeOffTarget) return;

    const amountCentavos = parseReaisToCentavos(writeOffAmount);
    if (amountCentavos === null) {
      toast.error("Informe o valor da baixa em reais (ex.: 190,00)");
      return;
    }
    if (amountCentavos > writeOffTarget.debtCentavos) {
      toast.error(
        `A baixa não pode passar da dívida de ${money(writeOffTarget.debtCentavos)}`,
      );
      return;
    }
    if (writeOffReason.trim().length < REFERRAL_WRITE_OFF_MIN_REASON_LENGTH) {
      toast.error("Descreva o motivo da baixa — ele fica gravado no histórico");
      return;
    }

    setWritingOff(true);
    try {
      const response = await fetch("/api/referrals/write-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          affiliateId: writeOffTarget.affiliateId,
          amountCentavos,
          reason: writeOffReason.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || "Erro ao lançar a baixa");
        return;
      }
      toast.success(
        data.clearsBalance
          ? `Baixa de ${money(data.amountCentavos)} lançada — saldo zerado`
          : `Baixa de ${money(data.amountCentavos)} lançada — saldo em ${money(data.availableAfterCentavos)}`,
      );
      setWriteOffTarget(null);
      await Promise.all([fetchNegatives(), fetchPayouts()]);
    } catch {
      toast.error("Erro ao lançar a baixa");
    } finally {
      setWritingOff(false);
    }
  };

  /**
   * Registrar pagamento = subir o comprovante e decidir, nessa ordem. O upload
   * é client-side (o arquivo vai do navegador direto ao Blob, com token desta
   * origem) — é o que permite 10 MB sem esbarrar no limite de corpo da Vercel.
   * Se o upload falhar, nada muda de estado; se a decisão falhar, o arquivo
   * órfão no Blob é aceitável — repetir o registro sobe outro (sufixo
   * aleatório) e é a URL da decisão bem-sucedida que vale.
   */
  const submitPayment = async () => {
    if (!payTarget || !proofFile) return;

    if (proofFile.size > 10 * 1024 * 1024) {
      toast.error("O comprovante deve ter no máximo 10 MB");
      return;
    }

    setUploadingProof(true);
    try {
      const blob = await upload(
        `referral-payouts/${payTarget.id}/${proofFile.name}`,
        proofFile,
        {
          access: "public",
          handleUploadUrl: "/api/referrals/payouts/proof-upload",
        },
      );

      const done = await decide(
        {
          payoutId: payTarget.id,
          status: "paid",
          proofUrl: blob.url,
        },
        "Pagamento registrado",
      );
      if (done) {
        setPayTarget(null);
        setProofFile(null);
      }
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? `Erro ao subir o comprovante: ${error.message}`
          : "Erro ao subir o comprovante",
      );
    } finally {
      setUploadingProof(false);
    }
  };

  const decide = async (
    body: {
      payoutId: string;
      status: "approved" | "paid" | "denied";
      proofUrl?: string;
      reason?: string;
    },
    successMessage: string,
  ) => {
    setActionLoading(body.payoutId);
    try {
      const response = await fetch("/api/referrals/payouts/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || "Erro ao processar o saque");
        return false;
      }
      toast.success(successMessage);
      await fetchPayouts();
      return true;
    } catch {
      toast.error("Erro ao processar o saque");
      return false;
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Saques (v2)</h1>
          <p className="text-sm text-muted-foreground">
            O Pix só pode ser enviado para uma chave IGUAL ao documento do
            pedido — o titular exibido pelo banco é a conferência.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Solicitados</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {totals.requested ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Aprovados</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {totals.approved ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Pagos</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {totals.paid ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/*
        Saldos negativos. Só aparece quando existe algum: uma tabela vazia
        permanente treinaria o operador a ignorar a seção justamente quando ela
        passasse a ter uma linha.
      */}
      {negatives.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <TrendingDown className="h-4 w-4 text-destructive" />
              Saldos negativos
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Estorno que chegou depois do repasse. Enquanto o saldo estiver
              negativo o afiliado não consegue sacar. A baixa é um lançamento
              novo, com autor e motivo, visível no extrato dele — nenhum
              lançamento anterior é alterado. Uma comissão nova também reduz o
              negativo sozinha.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Afiliado</TableHead>
                  <TableHead className="text-right">Liberado</TableHead>
                  <TableHead className="text-right">Em saque aberto</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {negatives.map((row) => (
                  <TableRow key={row.affiliateId}>
                    <TableCell>
                      <p className="font-medium">{row.user.name || "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.user.email}
                      </p>
                      <code className="text-xs text-muted-foreground">
                        {row.affiliateCode}
                      </code>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                      {money(row.releasedCentavos)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                      {money(row.blockedCentavos)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-destructive">
                      {money(row.availableCentavos)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setWriteOffTarget(row);
                          // Pré-preenchido com a dívida inteira: zerar é o caso
                          // comum, e reduzir continua possível editando.
                          setWriteOffAmount(
                            (row.debtCentavos / 100).toFixed(2).replace(".", ","),
                          );
                          setWriteOffReason("");
                        }}
                      >
                        Dar baixa
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-base font-medium">Fila de saques</CardTitle>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filtrar status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="requested">Solicitados</SelectItem>
              <SelectItem value="approved">Aprovados</SelectItem>
              <SelectItem value="paid">Pagos</SelectItem>
              <SelectItem value="denied">Negados</SelectItem>
              <SelectItem value="cancelled">Cancelados</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : payouts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum pedido de saque
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Afiliado</TableHead>
                  <TableHead>Documento do pedido</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Decisão</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((row) => {
                  const busy = actionLoading === row.id;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <p className="font-medium">{row.user.name || "—"}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.user.email}
                        </p>
                        <code className="text-xs text-muted-foreground">
                          {row.affiliateCode}
                        </code>
                      </TableCell>
                      <TableCell>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          {formatTaxDocument(
                            row.taxDocument.document,
                            row.taxDocument.type,
                          )}
                        </code>
                        <p className="mt-1 text-xs uppercase text-muted-foreground">
                          {row.taxDocument.type}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium tabular-nums">
                        {money(row.amountCentavos)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGE[row.status]}>
                          {REFERRAL_PAYOUT_STATUS_LABELS[row.status]}
                        </Badge>
                        {row.denialReason && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {row.denialReason}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <p>Pedido em {formatDate(row.createdAt)}</p>
                        {row.reviewedAt && (
                          <p className="text-xs">
                            Revisado {formatDate(row.reviewedAt)} por{" "}
                            {row.adminEmail ?? "—"}
                          </p>
                        )}
                        {row.paidAt && (
                          <p className="text-xs">
                            Pago {formatDate(row.paidAt)}
                            {row.proofUrl && (
                              <>
                                {" · "}
                                <a
                                  className="underline underline-offset-4"
                                  href={row.proofUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  comprovante
                                </a>
                              </>
                            )}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {row.status === "requested" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-green-600 hover:text-green-700"
                                  disabled={busy}
                                  aria-label="Aprovar saque"
                                  onClick={() =>
                                    decide(
                                      { payoutId: row.id, status: "approved" },
                                      "Saque aprovado",
                                    )
                                  }
                                >
                                  {busy ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <CheckCircle className="h-4 w-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Aprovar o saque — autoriza o repasse, sem mover
                                dinheiro ainda
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {row.status === "approved" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={busy}
                                  aria-label="Registrar pagamento"
                                  onClick={() => {
                                    setPayTarget(row);
                                    setProofFile(null);
                                  }}
                                >
                                  <Receipt className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Registrar o pagamento — anexa o comprovante e
                                lança o débito no extrato
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {(row.status === "requested" ||
                            row.status === "approved") && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-red-600 hover:text-red-700"
                                  disabled={busy}
                                  aria-label="Negar saque"
                                  onClick={() => {
                                    setDenyTarget(row);
                                    setDenyReason("");
                                  }}
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Negar o saque — o valor volta ao saldo
                                disponível do afiliado
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Marcar como pago — o comprovante é obrigatório */}
      <Dialog
        open={payTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPayTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
            <DialogDescription>
              {payTarget && (
                <>
                  {money(payTarget.amountCentavos)} para{" "}
                  {formatTaxDocument(
                    payTarget.taxDocument.document,
                    payTarget.taxDocument.type,
                  )}
                  . É este o momento em que o lançamento negativo entra no
                  extrato do afiliado.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="referral-payout-proof">
              Comprovante (imagem ou PDF)
            </Label>
            <Input
              id="referral-payout-proof"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(event) =>
                setProofFile(event.target.files?.[0] ?? null)
              }
            />
            <p className="text-xs text-muted-foreground">
              O arquivo sobe para o storage no registrar, e o link fica gravado
              no pedido — é ele que abre depois como &quot;comprovante&quot;.
              Máximo 10 MB.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>
              Cancelar
            </Button>
            <Button
              disabled={
                uploadingProof ||
                actionLoading === payTarget?.id ||
                proofFile === null
              }
              onClick={submitPayment}
            >
              {(uploadingProof || actionLoading === payTarget?.id) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Registrar pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dar baixa num saldo negativo — motivo obrigatório */}
      <Dialog
        open={writeOffTarget !== null}
        onOpenChange={(open) => {
          if (!open) setWriteOffTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dar baixa no saldo negativo</DialogTitle>
            <DialogDescription>
              {writeOffTarget && (
                <>
                  {writeOffTarget.user.email} deve{" "}
                  {money(writeOffTarget.debtCentavos)}. A baixa entra como
                  lançamento próprio no extrato dele, com o seu e-mail e o
                  motivo — nada do histórico é apagado ou reescrito.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="referral-write-off-amount">Valor (R$)</Label>
              <Input
                id="referral-write-off-amount"
                inputMode="decimal"
                value={writeOffAmount}
                onChange={(event) => setWriteOffAmount(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Vem preenchido com a dívida inteira. Um valor menor reduz o
                negativo sem zerá-lo; maior que a dívida é recusado.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="referral-write-off-reason">Motivo</Label>
              <Textarea
                id="referral-write-off-reason"
                placeholder="Ex.: chargeback recebido 120 dias após o repasse; perda assumida pela empresa."
                value={writeOffReason}
                onChange={(event) => setWriteOffReason(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWriteOffTarget(null)}>
              Cancelar
            </Button>
            <Button
              disabled={
                writingOff ||
                writeOffReason.trim().length <
                  REFERRAL_WRITE_OFF_MIN_REASON_LENGTH
              }
              onClick={submitWriteOff}
            >
              {writingOff && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Lançar baixa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Negar */}
      <Dialog
        open={denyTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDenyTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Negar saque</DialogTitle>
            <DialogDescription>
              O motivo aparece para o afiliado no painel dele. Nenhum lançamento
              é criado — o dinheiro volta para o saldo disponível.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Motivo (opcional)"
            value={denyReason}
            onChange={(event) => setDenyReason(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDenyTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={actionLoading === denyTarget?.id}
              onClick={async () => {
                if (!denyTarget) return;
                const done = await decide(
                  {
                    payoutId: denyTarget.id,
                    status: "denied",
                    reason: denyReason,
                  },
                  "Saque negado",
                );
                if (done) setDenyTarget(null);
              }}
            >
              Negar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}
