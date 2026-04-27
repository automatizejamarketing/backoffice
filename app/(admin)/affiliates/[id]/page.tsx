"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Loader2,
  MousePointerClick,
  Users,
  DollarSign,
  TrendingUp,
  Ban,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

type AffiliateDetail = {
  id: string;
  userId: string;
  code: string;
  status: string;
  stripePromotionCodeId: string | null;
  commissionRate: number;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  blockedBy: string | null;
  blockedAt: string | null;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    image_url: string | null;
  };
};

type Metrics = {
  clicks: number;
  conversions: number;
  revenue: number;
  commissionTotal: number;
  commissionPaid: number;
};

type Conversion = {
  id: string;
  amount: number;
  commissionAmount: number;
  currency: string;
  status: string;
  stripeInvoiceId: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string | null;
  };
};

type ActionLog = {
  id: string;
  adminEmail: string;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
};

const STATUS_BADGE: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
  pending: { variant: "outline", label: "Pendente" },
  approved: { variant: "default", label: "Aprovado" },
  rejected: { variant: "destructive", label: "Rejeitado" },
  blocked: { variant: "secondary", label: "Bloqueado" },
};

const CONVERSION_STATUS_BADGE: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
  pending: { variant: "outline", label: "Pendente" },
  approved: { variant: "secondary", label: "Aprovada" },
  paid: { variant: "default", label: "Paga" },
  rejected: { variant: "destructive", label: "Rejeitada" },
};

const ACTION_LABELS: Record<string, string> = {
  approved: "Aprovação",
  rejected: "Rejeição",
  blocked: "Bloqueio",
  reactivated: "Reativação",
  code_edited: "Edição de código",
};

export default function AffiliateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [affiliate, setAffiliate] = useState<AffiliateDetail | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [actionLogs, setActionLogs] = useState<ActionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingConversion, setUpdatingConversion] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Block dialog
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/affiliates/${id}`);
      if (!res.ok) {
        toast.error("Afiliado não encontrado");
        return;
      }
      const data = await res.json();
      setAffiliate(data.affiliate);
      setMetrics(data.metrics);
      setConversions(data.conversions || []);
      setActionLogs(data.actionLogs || []);
    } catch {
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateConversionStatus = async (
    conversionId: string,
    status: string,
  ) => {
    setUpdatingConversion(conversionId);
    try {
      const res = await fetch(`/api/affiliates/conversions/${conversionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        toast.success("Status atualizado");
        fetchData();
      } else {
        toast.error("Erro ao atualizar status");
      }
    } catch {
      toast.error("Erro ao atualizar status");
    } finally {
      setUpdatingConversion(null);
    }
  };

  const handleBlock = async () => {
    if (!affiliate) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/affiliates/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          affiliateId: affiliate.id,
          reason: blockReason,
        }),
      });
      if (res.ok) {
        toast.success("Afiliado bloqueado");
        setBlockDialogOpen(false);
        setBlockReason("");
        fetchData();
      } else {
        const err = await res.json();
        toast.error(err.error || "Erro ao bloquear");
      }
    } catch {
      toast.error("Erro ao bloquear afiliado");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReactivate = async () => {
    if (!affiliate) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/affiliates/reactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ affiliateId: affiliate.id }),
      });
      if (res.ok) {
        toast.success("Afiliado reativado com sucesso!");
        fetchData();
      } else {
        const err = await res.json();
        toast.error(err.error || "Erro ao reativar");
      }
    } catch {
      toast.error("Erro ao reativar afiliado");
    } finally {
      setActionLoading(false);
    }
  };

  const formatCurrency = (cents: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(cents / 100);

  const formatDateTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    });

  const formatActionDetails = (log: ActionLog): string | null => {
    if (!log.details) return null;
    const d = log.details;
    switch (log.action) {
      case "code_edited":
        return `${d.old_code} → ${d.new_code}`;
      case "rejected":
      case "blocked":
        return d.reason ? String(d.reason) : null;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!affiliate) {
    return (
      <div className="p-6">
        <p>Afiliado não encontrado.</p>
        <Button variant="ghost" asChild className="mt-4">
          <Link href="/affiliates">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Link>
        </Button>
      </div>
    );
  }

  const statusBadge = STATUS_BADGE[affiliate.status] || STATUS_BADGE.pending;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/affiliates">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {affiliate.user.name || affiliate.user.email}
            </h1>
            <p className="text-sm text-muted-foreground">
              Código:{" "}
              <code className="rounded bg-muted px-1.5 py-0.5">
                {affiliate.code}
              </code>
              {" · "}
              Status:{" "}
              <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {affiliate.status === "approved" && (
            <Button
              variant="destructive"
              size="sm"
              disabled={actionLoading}
              onClick={() => setBlockDialogOpen(true)}
            >
              {actionLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Ban className="mr-2 h-4 w-4" />
              )}
              Bloquear
            </Button>
          )}
          {affiliate.status === "blocked" && (
            <Button
              variant="default"
              size="sm"
              disabled={actionLoading}
              onClick={handleReactivate}
            >
              {actionLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Reativar
            </Button>
          )}
        </div>
      </div>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informações</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground">Email</p>
              <p className="font-medium">{affiliate.user.email}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Comissão</p>
              <p className="font-medium">{affiliate.commissionRate}%</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Criado em</p>
              <p className="font-medium">
                {new Date(affiliate.createdAt).toLocaleDateString("pt-BR")}
              </p>
            </div>
            {affiliate.approvedBy && (
              <div>
                <p className="text-sm text-muted-foreground">Aprovado por</p>
                <p className="font-medium">{affiliate.approvedBy}</p>
              </div>
            )}
            {affiliate.blockedBy && (
              <div>
                <p className="text-sm text-muted-foreground">Bloqueado por</p>
                <p className="font-medium">{affiliate.blockedBy}</p>
              </div>
            )}
            {affiliate.stripePromotionCodeId && (
              <div>
                <p className="text-sm text-muted-foreground">
                  Stripe Promotion Code
                </p>
                <p className="font-mono text-sm">
                  {affiliate.stripePromotionCodeId}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Metrics */}
      {metrics && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                  <MousePointerClick className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Clicks</p>
                  <p className="text-2xl font-bold">{metrics.clicks}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                  <Users className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Conversões</p>
                  <p className="text-2xl font-bold">{metrics.conversions}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
                  <DollarSign className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Receita</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(metrics.revenue)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
                  <TrendingUp className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Comissão</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(metrics.commissionTotal)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Action Logs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico de Ações</CardTitle>
          <CardDescription>
            Registro de todas as ações administrativas nesta afiliação
          </CardDescription>
        </CardHeader>
        <CardContent>
          {actionLogs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma ação registrada
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/Hora</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Detalhes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actionLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {log.adminEmail}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {ACTION_LABELS[log.action] || log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatActionDetails(log) || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Conversions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversões</CardTitle>
          <CardDescription>
            Histórico de pagamentos gerados por este afiliado
          </CardDescription>
        </CardHeader>
        <CardContent>
          {conversions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma conversão registrada
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Comissão</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conversions.map((conv) => {
                  const badge =
                    CONVERSION_STATUS_BADGE[conv.status] ||
                    CONVERSION_STATUS_BADGE.pending;
                  return (
                    <TableRow key={conv.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {conv.user.name || "—"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {conv.user.email}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>{formatCurrency(conv.amount)}</TableCell>
                      <TableCell>
                        {formatCurrency(conv.commissionAmount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(conv.createdAt).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">
                        {conv.status !== "paid" && conv.status !== "rejected" && (
                          <Select
                            value={conv.status}
                            onValueChange={(val) =>
                              updateConversionStatus(conv.id, val)
                            }
                            disabled={updatingConversion === conv.id}
                          >
                            <SelectTrigger className="w-[130px]">
                              {updatingConversion === conv.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <SelectValue />
                              )}
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pendente</SelectItem>
                              <SelectItem value="approved">Aprovada</SelectItem>
                              <SelectItem value="paid">Paga</SelectItem>
                              <SelectItem value="rejected">Rejeitada</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Block Dialog */}
      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bloquear Afiliação</DialogTitle>
            <DialogDescription>
              O promotion code será desativado no Stripe. Informe o motivo
              (opcional).
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Motivo do bloqueio..."
            value={blockReason}
            onChange={(e) => setBlockReason(e.target.value)}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBlockDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleBlock}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Bloquear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
