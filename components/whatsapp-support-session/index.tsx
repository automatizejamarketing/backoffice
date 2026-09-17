"use client";

import { useState } from "react";
import { Copy, Loader2, ShieldCheck, Square } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useWhatsappSupportSession } from "./use-whatsapp-support-session";

export function WhatsappSupportSessionControl({
  userId,
}: {
  userId: string;
}) {
  const { query, start, end } = useWhatsappSupportSession(userId);
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const activationCommand = start.data?.activationCommand;
  const session = query.data?.session;

  const startSession = () => {
    start.mutate(
      { phone, reason, durationMinutes },
      {
        onSuccess: () =>
          toast.success("Solicitação criada", {
            description:
              "Envie o comando pelo telefone informado para provar a posse.",
          }),
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const endSession = () => {
    if (!session) return;
    end.mutate(session.id, {
      onSuccess: () => toast.success("Modo suporte encerrado"),
      onError: (error) => toast.error(error.message),
    });
  };

  const copyCommand = async () => {
    if (!activationCommand) return;
    await navigator.clipboard.writeText(activationCommand);
    toast.success("Comando copiado");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5" />
          Testar Mat como cliente
        </CardTitle>
        <CardDescription>
          Sessão temporária, auditada e somente leitura. O vínculo real do
          cliente não é alterado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Não foi possível carregar o modo suporte</AlertTitle>
            <AlertDescription>{query.error.message}</AlertDescription>
          </Alert>
        ) : null}
        {query.data && !query.data.webhookAvailable ? (
          <Alert>
            <AlertTitle>Webhook do Mat indisponível em staging</AlertTitle>
            <AlertDescription>
              Esta tela e a API podem ser validadas aqui, mas o comando enviado
              ao número público chega em produção e não ativa esta sessão.
            </AlertDescription>
          </Alert>
        ) : null}

        {session ? (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant={session.state === "active" ? "default" : "secondary"}>
                {session.state === "active" ? "Ativa" : "Aguardando código"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {session.durationMinutes} minutos · {session.operatorEmail}
              </span>
            </div>
            <p className="text-sm">
              Telefone de teste: <strong>{session.phoneE164}</strong>
            </p>
            <p className="text-xs text-muted-foreground">{session.reason}</p>
            {activationCommand && session.state === "pending" ? (
              <div className="flex items-center gap-2 rounded-md bg-muted p-2">
                <code className="flex-1 text-sm">{activationCommand}</code>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => void copyCommand()}
                  aria-label="Copiar comando de ativação"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            ) : null}
            <Button
              type="button"
              variant="destructive"
              onClick={endSession}
              disabled={end.isPending}
            >
              {end.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Square className="size-4" />
              )}
              Encerrar agora
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`support-phone-${userId}`}>Seu WhatsApp</Label>
              <Input
                id={`support-phone-${userId}`}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="(11) 99999-9999"
                autoComplete="tel"
                inputMode="tel"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`support-duration-${userId}`}>Duração</Label>
              <Select
                value={String(durationMinutes)}
                onValueChange={(value) => setDurationMinutes(Number(value))}
              >
                <SelectTrigger id={`support-duration-${userId}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 minutos</SelectItem>
                  <SelectItem value="30">30 minutos</SelectItem>
                  <SelectItem value="60">60 minutos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`support-reason-${userId}`}>Motivo</Label>
              <Textarea
                id={`support-reason-${userId}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ex.: validar consulta de desempenho após incidente"
                maxLength={500}
              />
            </div>
            <Button
              type="button"
              onClick={startSession}
              disabled={
                start.isPending ||
                query.isPending ||
                query.isError ||
                phone.trim().length === 0 ||
                reason.trim().length < 10
              }
            >
              {start.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ShieldCheck className="size-4" />
              )}
              Gerar código temporário
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
