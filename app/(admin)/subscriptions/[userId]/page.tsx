"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  CreditCard,
  History,
  Loader2,
  Save,
  Shield,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface UserSubscriptionData {
  user: {
    id: string;
    email: string;
    imageUrl?: string;
    expirationDate?: string;
    stripeCustomerId?: string;
  };
  activeSubscription: {
    id: string;
    stripeSubscriptionId: string;
    planType: string;
    planName: string;
    status: string;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
    cancelAtPeriodEnd: boolean;
    createdAt: string;
  } | null;
  subscriptionHistory: Array<{
    id: string;
    planType: string;
    planName: string;
    status: string;
    createdAt: string;
    endedAt?: string;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    planType: string;
    planName: string;
    description?: string;
    failureReason?: string;
    paidAt?: string;
    createdAt: string;
  }>;
  events: Array<{
    id: string;
    eventType: string;
    eventLabel: string;
    fromPlan?: string;
    fromPlanName?: string;
    toPlan?: string;
    toPlanName?: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
  }>;
}

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Ativa", variant: "default" },
  past_due: { label: "Pagamento pendente", variant: "destructive" },
  canceled: { label: "Cancelada", variant: "secondary" },
  unpaid: { label: "Não paga", variant: "destructive" },
};

export default function UserSubscriptionPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = use(params);
  const router = useRouter();
  const [data, setData] = useState<UserSubscriptionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [newExpirationDate, setNewExpirationDate] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    fetchUserData();
  }, [userId]);

  const fetchUserData = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/subscriptions/${userId}`);
      const result = await response.json();
      setData(result);
      if (result.user?.expirationDate) {
        setNewExpirationDate(result.user.expirationDate.split("T")[0]);
      }
    } catch (error) {
      console.error("Error fetching user data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateExpiration = async () => {
    if (!newExpirationDate) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/subscriptions/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expirationDate: newExpirationDate }),
      });

      if (response.ok) {
        await fetchUserData();
        setDialogOpen(false);
      }
    } catch (error) {
      console.error("Error updating expiration date:", error);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container py-8 px-4">
        <p className="text-center text-muted-foreground">Usuário não encontrado</p>
      </div>
    );
  }

  const { user, activeSubscription, payments, events } = data;
  const statusInfo = activeSubscription?.status
    ? STATUS_LABELS[activeSubscription.status] || {
        label: activeSubscription.status,
        variant: "outline" as const,
      }
    : null;

  return (
    <div className="container py-8 px-4 max-w-4xl">
      <Button
        variant="ghost"
        className="mb-4"
        onClick={() => router.push("/subscriptions")}
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Voltar
      </Button>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Informações do usuário
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Email</span>
                <span className="font-medium">{user.email}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">ID</span>
                <span className="font-mono text-sm">{user.id}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Stripe Customer ID</span>
                <span className="font-mono text-sm">
                  {user.stripeCustomerId || "-"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Acesso até</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {user.expirationDate
                      ? new Date(user.expirationDate).toLocaleDateString("pt-BR")
                      : "-"}
                  </span>
                  <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        Editar
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Alterar data de expiração</DialogTitle>
                        <DialogDescription>
                          Defina uma nova data de expiração para o acesso do usuário.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="py-4">
                        <Label htmlFor="expiration">Nova data de expiração</Label>
                        <Input
                          id="expiration"
                          type="date"
                          value={newExpirationDate}
                          onChange={(e) => setNewExpirationDate(e.target.value)}
                          className="mt-2"
                        />
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setDialogOpen(false)}
                        >
                          Cancelar
                        </Button>
                        <Button onClick={handleUpdateExpiration} disabled={isSaving}>
                          {isSaving ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <Save className="h-4 w-4 mr-2" />
                          )}
                          Salvar
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Assinatura atual
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeSubscription ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Plano</span>
                  <Badge variant="outline">{activeSubscription.planName}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <div className="flex items-center gap-2">
                    {statusInfo && (
                      <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                    )}
                    {activeSubscription.cancelAtPeriodEnd && (
                      <Badge variant="secondary">Cancelamento agendado</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Período atual</span>
                  <span className="font-medium">
                    {activeSubscription.currentPeriodStart
                      ? new Date(
                          activeSubscription.currentPeriodStart
                        ).toLocaleDateString("pt-BR")
                      : "-"}{" "}
                    -{" "}
                    {activeSubscription.currentPeriodEnd
                      ? new Date(
                          activeSubscription.currentPeriodEnd
                        ).toLocaleDateString("pt-BR")
                      : "-"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Stripe Subscription ID</span>
                  <span className="font-mono text-sm">
                    {activeSubscription.stripeSubscriptionId}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4">
                Nenhuma assinatura ativa
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Histórico de pagamentos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {payments.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>
                        {new Date(payment.createdAt).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell>{payment.planName}</TableCell>
                      <TableCell>
                        {new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: payment.currency.toUpperCase(),
                        }).format(payment.amount / 100)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            payment.status === "succeeded"
                              ? "default"
                              : payment.status === "failed"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {payment.status === "succeeded"
                            ? "Pago"
                            : payment.status === "failed"
                              ? "Falhou"
                              : payment.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-center text-muted-foreground py-4">
                Nenhum pagamento registrado
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Histórico de eventos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {events.length > 0 ? (
              <div className="space-y-3">
                {events.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div>
                      <p className="font-medium">{event.eventLabel}</p>
                      {event.fromPlanName && event.toPlanName && (
                        <p className="text-sm text-muted-foreground">
                          {event.fromPlanName} → {event.toPlanName}
                        </p>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {new Date(event.createdAt).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4">
                Nenhum evento registrado
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
