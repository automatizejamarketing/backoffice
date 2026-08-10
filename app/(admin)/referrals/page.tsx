"use client";

// Fila de afiliação do programa v2 (`referral_*`).
//
// Aprovar é criar o acordo: o formulário de acordo é obrigatório em toda
// aprovação, e é o MESMO formulário usado para recrutar alguém que nunca pediu.
// A transação do lado do servidor é que garante o invariante — aqui a interface
// apenas não oferece um caminho que o violaria.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
  Ban,
  CheckCircle,
  Handshake,
  Loader2,
  Plus,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  describeAgreementDuration,
  describeAgreementValue,
} from "@/lib/referral/agreement";
import {
  describeMigrationChoice,
  type ReferralMigrationChoice,
} from "@/lib/referral/renegotiation";
import {
  AgreementFields,
  agreementFormFromAgreement,
  agreementFormToPayload,
  EMPTY_AGREEMENT_FORM,
  type AgreementFormState,
} from "./agreement-fields";

type ReferralAffiliateRow = {
  id: string;
  code: string;
  status: "pending" | "approved" | "rejected" | "blocked";
  requestedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  blockedBy: string | null;
  blockedAt: string | null;
  blockReason: string | null;
  user: { id: string; email: string; name: string | null };
  agreement: {
    id: string;
    format: "percentage" | "fixed";
    percentageBps: number | null;
    fixedAmountCentavos: number | null;
    duration: "lifetime" | "n_cycles" | "first_sale";
    durationCycles: number | null;
    effectiveFrom: string;
  } | null;
  customerCount: number;
};

const STATUS_BADGE: Record<
  ReferralAffiliateRow["status"],
  { variant: "default" | "secondary" | "destructive" | "outline"; label: string }
> = {
  pending: { variant: "outline", label: "Pendente" },
  approved: { variant: "default", label: "Aprovado" },
  rejected: { variant: "destructive", label: "Recusado" },
  blocked: { variant: "secondary", label: "Bloqueado" },
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

export default function ReferralsPage() {
  const [affiliates, setAffiliates] = useState<ReferralAffiliateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [approveTarget, setApproveTarget] =
    useState<ReferralAffiliateRow | null>(null);
  const [approveTerms, setApproveTerms] =
    useState<AgreementFormState>(EMPTY_AGREEMENT_FORM);

  const [recruitOpen, setRecruitOpen] = useState(false);
  const [recruitTerms, setRecruitTerms] =
    useState<AgreementFormState>(EMPTY_AGREEMENT_FORM);
  const [recruitUserId, setRecruitUserId] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<
    Array<{ id: string; email: string; name: string | null }>
  >([]);

  const [renegotiateTarget, setRenegotiateTarget] =
    useState<ReferralAffiliateRow | null>(null);
  const [renegotiateTerms, setRenegotiateTerms] =
    useState<AgreementFormState>(EMPTY_AGREEMENT_FORM);
  // `null` é o estado inicial e não tem botão que o submeta. A escolha de
  // migração é decisão de negócio, caso a caso, e a interface tem que forçá-la
  // a ser tomada — nunca oferecer um default (ticket 13).
  const [migrationChoice, setMigrationChoice] =
    useState<ReferralMigrationChoice | null>(null);

  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [blockTarget, setBlockTarget] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState("");

  const fetchAffiliates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const response = await fetch(`/api/referrals?${params}`);
      const data = await response.json();
      setAffiliates(data.affiliates ?? []);
    } catch {
      toast.error("Erro ao carregar afiliados");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchAffiliates();
  }, [fetchAffiliates]);

  const submitApproval = async (
    terms: AgreementFormState,
    target: { affiliateId?: string; userId?: string },
    loadingKey: string,
  ) => {
    const parsed = agreementFormToPayload(terms);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return false;
    }

    setActionLoading(loadingKey);
    try {
      const response = await fetch("/api/referrals/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...target, ...parsed.payload }),
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || "Erro ao aprovar afiliado");
        return false;
      }
      toast.success(`Afiliado aprovado — código ${data.code}`);
      await fetchAffiliates();
      return true;
    } catch {
      toast.error("Erro ao aprovar afiliado");
      return false;
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprove = async () => {
    if (!approveTarget) return;
    const done = await submitApproval(
      approveTerms,
      { affiliateId: approveTarget.id },
      approveTarget.id,
    );
    if (done) {
      setApproveTarget(null);
      setApproveTerms(EMPTY_AGREEMENT_FORM);
    }
  };

  const handleRecruit = async () => {
    if (!recruitUserId) {
      toast.error("Selecione um usuário");
      return;
    }
    const done = await submitApproval(
      recruitTerms,
      { userId: recruitUserId },
      "recruit",
    );
    if (done) {
      setRecruitOpen(false);
      setRecruitTerms(EMPTY_AGREEMENT_FORM);
      setRecruitUserId("");
      setUserQuery("");
      setUserResults([]);
    }
  };

  const openRenegotiation = (row: ReferralAffiliateRow) => {
    setRenegotiateTarget(row);
    // Parte do acordo vigente: renegociar quase sempre é mexer num número, e
    // redigitar o resto é como uma vitalícia vira 3 ciclos sem ninguém querer.
    setRenegotiateTerms(
      row.agreement
        ? agreementFormFromAgreement(row.agreement)
        : EMPTY_AGREEMENT_FORM,
    );
    setMigrationChoice(null);
  };

  const handleRenegotiate = async () => {
    if (!renegotiateTarget) return;
    if (!migrationChoice) {
      toast.error(
        "Escolha o que acontece com os indicados existentes antes de salvar",
      );
      return;
    }

    const parsed = agreementFormToPayload(renegotiateTerms);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }

    setActionLoading(renegotiateTarget.id);
    try {
      const response = await fetch("/api/referrals/renegotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          affiliateId: renegotiateTarget.id,
          migrateExistingCustomers: migrationChoice,
          ...parsed.payload,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || "Erro ao renegociar o acordo");
        return;
      }
      toast.success("Acordo renegociado", { description: data.summary });
      setRenegotiateTarget(null);
      setMigrationChoice(null);
      await fetchAffiliates();
    } catch {
      toast.error("Erro ao renegociar o acordo");
    } finally {
      setActionLoading(null);
    }
  };

  const searchUsers = async (query: string) => {
    setUserQuery(query);
    setRecruitUserId("");
    if (query.trim().length < 3) {
      setUserResults([]);
      return;
    }
    try {
      const response = await fetch(
        `/api/users/search?q=${encodeURIComponent(query)}`,
      );
      setUserResults(await response.json());
    } catch {
      setUserResults([]);
    }
  };

  const postAction = async (
    path: string,
    body: Record<string, unknown>,
    successMessage: string,
    loadingKey: string,
  ) => {
    setActionLoading(loadingKey);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || "Erro ao executar a ação");
        return false;
      }
      toast.success(successMessage);
      await fetchAffiliates();
      return true;
    } catch {
      toast.error("Erro ao executar a ação");
      return false;
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Afiliados (v2)</h1>
          <p className="text-sm text-muted-foreground">
            Pedidos de afiliação, acordos de comissão e bloqueios do programa
            novo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/referrals/metrics">Métricas</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/referrals/payouts">Fila de saques</Link>
          </Button>
          <Button onClick={() => setRecruitOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Criar afiliação
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-base font-medium">
            Fila de afiliação
          </CardTitle>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filtrar status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendentes</SelectItem>
              <SelectItem value="approved">Aprovados</SelectItem>
              <SelectItem value="rejected">Recusados</SelectItem>
              <SelectItem value="blocked">Bloqueados</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : affiliates.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum afiliado encontrado
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Acordo vigente</TableHead>
                  <TableHead>Decisão</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {affiliates.map((row) => {
                  const badge = STATUS_BADGE[row.status];
                  const busy = actionLoading === row.id;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <p className="font-medium">{row.user.name || "—"}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.user.email}
                        </p>
                      </TableCell>
                      <TableCell>
                        {row.status === "pending" ||
                        row.status === "rejected" ? (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        ) : (
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                            {row.code}
                          </code>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.agreement ? (
                          <>
                            <p className="font-medium">
                              {describeAgreementValue(row.agreement)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {describeAgreementDuration(row.agreement)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {row.customerCount === 1
                                ? "1 indicado"
                                : `${row.customerCount} indicados`}
                            </p>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <p>
                          Pedido em {formatDate(row.requestedAt)}
                        </p>
                        {row.approvedAt && (
                          <p className="text-xs">
                            Aprovado {formatDate(row.approvedAt)} por{" "}
                            {row.approvedBy ?? "—"}
                          </p>
                        )}
                        {row.rejectedAt && (
                          <p className="text-xs">
                            Recusado {formatDate(row.rejectedAt)} por{" "}
                            {row.rejectedBy ?? "—"}
                          </p>
                        )}
                        {row.blockedAt && (
                          <p className="text-xs">
                            Bloqueado {formatDate(row.blockedAt)} por{" "}
                            {row.blockedBy ?? "—"}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {row.status === "pending" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-green-600 hover:text-green-700"
                                disabled={busy}
                                aria-label="Aprovar"
                                onClick={() => {
                                  setApproveTarget(row);
                                  setApproveTerms(EMPTY_AGREEMENT_FORM);
                                }}
                              >
                                {busy ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-red-600 hover:text-red-700"
                                disabled={busy}
                                aria-label="Recusar"
                                onClick={() => {
                                  setRejectTarget(row.id);
                                  setRejectReason("");
                                }}
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {row.status === "approved" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={busy}
                                aria-label="Renegociar acordo"
                                onClick={() => openRenegotiation(row)}
                              >
                                {busy ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Handshake className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-orange-600 hover:text-orange-700"
                                disabled={busy}
                                aria-label="Bloquear"
                                onClick={() => {
                                  setBlockTarget(row.id);
                                  setBlockReason("");
                                }}
                              >
                                <Ban className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {row.status === "blocked" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={busy}
                              aria-label="Reativar"
                              onClick={() =>
                                postAction(
                                  "/api/referrals/reactivate",
                                  { affiliateId: row.id },
                                  "Afiliado reativado",
                                  row.id,
                                )
                              }
                            >
                              {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          {row.status === "rejected" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => {
                                setApproveTarget(row);
                                setApproveTerms(EMPTY_AGREEMENT_FORM);
                              }}
                            >
                              Aprovar mesmo assim
                            </Button>
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

      {/* Aprovar um pedido da fila */}
      <Dialog
        open={approveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setApproveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprovar afiliação</DialogTitle>
            <DialogDescription>
              {approveTarget?.user.email} — a aprovação e o acordo são gravados
              na mesma transação.
            </DialogDescription>
          </DialogHeader>
          <AgreementFields value={approveTerms} onChange={setApproveTerms} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>
              Cancelar
            </Button>
            <Button
              onClick={handleApprove}
              disabled={actionLoading === approveTarget?.id}
            >
              {actionLoading === approveTarget?.id && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Aprovar e criar acordo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renegociar — o acordo antigo é superado, nunca apagado */}
      <Dialog
        open={renegotiateTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenegotiateTarget(null);
            setMigrationChoice(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Renegociar acordo</DialogTitle>
            <DialogDescription>
              {renegotiateTarget?.user.email} — o acordo atual
              {renegotiateTarget?.agreement
                ? ` (${describeAgreementValue(renegotiateTarget.agreement)} · ${describeAgreementDuration(
                    renegotiateTarget.agreement,
                  )})`
                : ""}{" "}
              é marcado como superado e permanece no banco, explicando as
              comissões que já produziu.
            </DialogDescription>
          </DialogHeader>

          <AgreementFields
            value={renegotiateTerms}
            onChange={setRenegotiateTerms}
          />

          <div className="space-y-2">
            <Label>Indicados existentes</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    choice: "migrate" as const,
                    title: "Migrar para o acordo novo",
                  },
                  {
                    choice: "keep" as const,
                    title: "Manter na regra antiga",
                  },
                ] satisfies Array<{
                  choice: ReferralMigrationChoice;
                  title: string;
                }>
              ).map((option) => (
                <button
                  key={option.choice}
                  type="button"
                  aria-pressed={migrationChoice === option.choice}
                  onClick={() => setMigrationChoice(option.choice)}
                  className={`rounded-md border p-3 text-left transition-colors ${
                    migrationChoice === option.choice
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted"
                  }`}
                >
                  <span className="block text-sm font-medium">
                    {option.title}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {describeMigrationChoice(
                      option.choice,
                      renegotiateTarget?.customerCount ?? 0,
                    )}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              A escolha vale da próxima fatura em diante. Comissões já geradas
              mantêm o valor e o snapshot originais — nada é reprecificado.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenegotiateTarget(null);
                setMigrationChoice(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleRenegotiate}
              // Sem escolha não há caminho: o botão não submete, e o servidor
              // recusaria de qualquer forma.
              disabled={
                migrationChoice === null ||
                actionLoading === renegotiateTarget?.id
              }
            >
              {actionLoading === renegotiateTarget?.id && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {migrationChoice === null
                ? "Escolha o destino dos indicados"
                : "Renegociar acordo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recrutar alguém que não pediu — mesmo formulário, mesma rota */}
      <Dialog open={recruitOpen} onOpenChange={setRecruitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar afiliação</DialogTitle>
            <DialogDescription>
              Para recrutar alguém que ainda não pediu. O afiliado já nasce
              aprovado, com código e acordo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="referral-user-search">Usuário</Label>
            <Input
              id="referral-user-search"
              placeholder="Buscar por e-mail (mínimo 3 letras)"
              value={userQuery}
              onChange={(event) => searchUsers(event.target.value)}
            />
            {userResults.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-md border">
                {userResults.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted ${
                      recruitUserId === candidate.id ? "bg-muted" : ""
                    }`}
                    onClick={() => {
                      setRecruitUserId(candidate.id);
                      setUserQuery(candidate.email);
                      setUserResults([]);
                    }}
                  >
                    <span className="font-medium">
                      {candidate.name || "—"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {candidate.email}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <AgreementFields value={recruitTerms} onChange={setRecruitTerms} />

          <DialogFooter>
            <Button variant="outline" onClick={() => setRecruitOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleRecruit}
              disabled={actionLoading === "recruit"}
            >
              {actionLoading === "recruit" && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Criar e aprovar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recusar */}
      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recusar pedido</DialogTitle>
            <DialogDescription>
              O motivo aparece para o candidato na página dele.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Motivo (opcional)"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={actionLoading === rejectTarget}
              onClick={async () => {
                if (!rejectTarget) return;
                const done = await postAction(
                  "/api/referrals/reject",
                  { affiliateId: rejectTarget, reason: rejectReason },
                  "Pedido recusado",
                  rejectTarget,
                );
                if (done) setRejectTarget(null);
              }}
            >
              Recusar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bloquear */}
      <Dialog
        open={blockTarget !== null}
        onOpenChange={(open) => {
          if (!open) setBlockTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bloquear afiliado</DialogTitle>
            <DialogDescription>
              Interrompe a geração de comissão nova. O que já foi ganho continua
              sendo dele.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Motivo (opcional)"
            value={blockReason}
            onChange={(event) => setBlockReason(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={actionLoading === blockTarget}
              onClick={async () => {
                if (!blockTarget) return;
                const done = await postAction(
                  "/api/referrals/block",
                  { affiliateId: blockTarget, reason: blockReason },
                  "Afiliado bloqueado",
                  blockTarget,
                );
                if (done) setBlockTarget(null);
              }}
            >
              Bloquear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
