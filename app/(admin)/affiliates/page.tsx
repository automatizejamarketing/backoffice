"use client";

import { useState, useEffect, useCallback } from "react";
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
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Plus,
  Eye,
} from "lucide-react";
import { toast } from "sonner";

type AffiliateRow = {
  id: string;
  userId: string;
  code: string;
  status: string;
  commissionRate: number;
  stripePromotionCodeId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    image_url: string | null;
  };
};

const STATUS_BADGE: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
  pending: { variant: "outline", label: "Pendente" },
  approved: { variant: "default", label: "Aprovado" },
  rejected: { variant: "destructive", label: "Rejeitado" },
};

export default function AffiliatesPage() {
  const [affiliates, setAffiliates] = useState<AffiliateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Reject dialog
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Create dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createUserId, setCreateUserId] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userSearchResults, setUserSearchResults] = useState<
    Array<{ id: string; email: string; name: string | null }>
  >([]);

  const fetchAffiliates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/affiliates?${params}`);
      const data = await res.json();
      setAffiliates(data.affiliates || []);
    } catch {
      toast.error("Erro ao carregar afiliados");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchAffiliates();
  }, [fetchAffiliates]);

  const handleApprove = async (affiliateId: string) => {
    setActionLoading(affiliateId);
    try {
      const res = await fetch("/api/affiliates/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ affiliateId }),
      });
      if (res.ok) {
        toast.success("Afiliado aprovado com sucesso!");
        fetchAffiliates();
      } else {
        const err = await res.json();
        toast.error(err.error || "Erro ao aprovar");
      }
    } catch {
      toast.error("Erro ao aprovar afiliado");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    setActionLoading(rejectTarget);
    try {
      const res = await fetch("/api/affiliates/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          affiliateId: rejectTarget,
          reason: rejectReason,
        }),
      });
      if (res.ok) {
        toast.success("Afiliado rejeitado");
        setRejectDialogOpen(false);
        setRejectReason("");
        fetchAffiliates();
      } else {
        const err = await res.json();
        toast.error(err.error || "Erro ao rejeitar");
      }
    } catch {
      toast.error("Erro ao rejeitar afiliado");
    } finally {
      setActionLoading(null);
    }
  };

  const searchUsers = async (query: string) => {
    setUserSearchQuery(query);
    if (query.length < 3) {
      setUserSearchResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setUserSearchResults(data);
    } catch {
      setUserSearchResults([]);
    }
  };

  const handleCreate = async () => {
    if (!createUserId) {
      toast.error("Selecione um usuário");
      return;
    }
    setActionLoading("create");
    try {
      const res = await fetch("/api/affiliates/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: createUserId,
          code: createCode || undefined,
        }),
      });
      if (res.ok) {
        toast.success("Afiliado criado com sucesso!");
        setCreateDialogOpen(false);
        setCreateUserId("");
        setCreateCode("");
        setUserSearchQuery("");
        setUserSearchResults([]);
        fetchAffiliates();
      } else {
        const err = await res.json();
        toast.error(err.error || "Erro ao criar afiliado");
      }
    } catch {
      toast.error("Erro ao criar afiliado");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Afiliados</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie solicitações e afiliados ativos
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Criar Afiliado
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-base font-medium">
            Lista de Afiliados
          </CardTitle>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filtrar status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendentes</SelectItem>
              <SelectItem value="approved">Aprovados</SelectItem>
              <SelectItem value="rejected">Rejeitados</SelectItem>
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
                  <TableHead>Comissão</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {affiliates.map((aff) => {
                  const badge = STATUS_BADGE[aff.status] || STATUS_BADGE.pending;
                  return (
                    <TableRow key={aff.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {aff.user.name || "—"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {aff.user.email}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          {aff.code}
                        </code>
                      </TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell>{aff.commissionRate}%</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(aff.createdAt).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="icon" asChild>
                            <Link href={`/affiliates/${aff.id}`}>
                              <Eye className="h-4 w-4" />
                            </Link>
                          </Button>
                          {aff.status === "pending" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-green-600 hover:text-green-700"
                                disabled={actionLoading === aff.id}
                                onClick={() => handleApprove(aff.id)}
                              >
                                {actionLoading === aff.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-red-600 hover:text-red-700"
                                onClick={() => {
                                  setRejectTarget(aff.id);
                                  setRejectDialogOpen(true);
                                }}
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </>
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

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeitar Afiliação</DialogTitle>
            <DialogDescription>
              Informe o motivo da rejeição (opcional).
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Motivo da rejeição..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={actionLoading === rejectTarget}
            >
              {actionLoading === rejectTarget ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Rejeitar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar Afiliação</DialogTitle>
            <DialogDescription>
              Crie uma afiliação para um usuário específico. O promotion code
              será criado automaticamente no Stripe.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Buscar Usuário</Label>
              <Input
                placeholder="Digite o email do usuário..."
                value={userSearchQuery}
                onChange={(e) => searchUsers(e.target.value)}
              />
              {userSearchResults.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-md border">
                  {userSearchResults.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                        createUserId === u.id ? "bg-primary/10" : ""
                      }`}
                      onClick={() => {
                        setCreateUserId(u.id);
                        setUserSearchQuery(u.email);
                        setUserSearchResults([]);
                      }}
                    >
                      <span className="font-medium">{u.name || "—"}</span>
                      <span className="ml-2 text-muted-foreground">
                        {u.email}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Código (opcional)</Label>
              <Input
                placeholder="Ex: JOAO_ABC1 (gerado automaticamente se vazio)"
                value={createCode}
                onChange={(e) => setCreateCode(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!createUserId || actionLoading === "create"}
            >
              {actionLoading === "create" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Criar Afiliado
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
