"use client";

import { Copy, Link2, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { navigateToFacebookOAuth } from "@/lib/meta-business/navigate-facebook-oauth";
import { AUTOMATIZE_PEOPLE_EMAIL } from "@/lib/meta-business/partner-access-status";
import type { PortfolioAccessReport } from "@/lib/meta-business/portfolio-access-server";
import { cn } from "@/lib/utils";

/**
 * "Conectar pelo portfólio": the client already invited Automatize (usually
 * contato@automatizemarketing.com) under Pessoas, so a consultant runs the
 * same BISU login the client would, picks the client's portfolio, and the
 * client is connected without doing anything. The check before is read-only.
 */
export function PortfolioConnect({
  userId,
  className,
}: {
  userId: string;
  className?: string;
}) {
  const [report, setReport] = useState<PortfolioAccessReport | null>(null);
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState<"connect" | "credential" | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/users/${userId}/meta-account/portfolio-access`);
      if (!res.ok) throw new Error(String(res.status));
      setReport((await res.json()) as PortfolioAccessReport);
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  }, [userId]);

  useEffect(() => {
    void check();
  }, [check]);

  const start = async (purpose: "connect" | "credential") => {
    setStarting(purpose);
    try {
      const res = await fetch(`/api/users/${userId}/meta-account/admin-reconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          purpose === "credential"
            ? { confirm: true, purpose: "consultant_credential" }
            : { confirm: true },
        ),
      });
      const body = (await res.json().catch(() => null)) as { authUrl?: string } | null;
      if (res.ok && body?.authUrl) {
        navigateToFacebookOAuth(body.authUrl);
        return;
      }
      toast.error("Não foi possível abrir o login da Meta.");
    } catch {
      toast.error("Não foi possível abrir o login da Meta.");
    }
    setStarting(null);
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(AUTOMATIZE_PEOPLE_EMAIL);
      toast.success("E-mail copiado");
    } catch {
      toast.error("Não foi possível copiar o e-mail");
    }
  };

  const match = report?.matches.find((item) => item.people.some((p) => p.fullControl)) ??
    report?.matches[0];
  const portfolioName =
    match?.businessName ?? report?.businesses[0]?.name ?? null;
  const portfolioLabel = portfolioName
    ? `“${portfolioName}”`
    : match?.businessId ?? report?.businesses[0]?.businessId ?? null;
  const fullControl = match?.people.filter((p) => p.fullControl) ?? [];
  const shared = report?.status === "shared";

  return (
    <div
      className={cn(
        "space-y-2 rounded-md border p-3 text-xs",
        shared
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-border bg-muted/30",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">Conectar pelo portfólio</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-6 px-1.5 text-[11px]"
          onClick={() => void check()}
          disabled={checking}
        >
          {checking ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          Verificar
        </Button>
      </div>

      <p className="text-muted-foreground">
        {checking && !report
          ? "Verificando se o cliente já compartilhou o portfólio com a Automatize…"
          : failed
            ? "Não deu para verificar agora. Você ainda pode conectar."
            : statusText(report, portfolioLabel, fullControl.map((p) => p.name ?? p.actorAdminEmail))}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={shared ? "default" : "outline"}
          onClick={() => setConfirmOpen(true)}
          disabled={starting !== null}
        >
          {starting === "connect" ? "Abrindo a Meta…" : "Conectar pelo portfólio"}
        </Button>
        {report && report.status !== "shared" ? (
          <button
            type="button"
            onClick={() => void copyEmail()}
            className="inline-flex items-center gap-1 rounded border border-border/80 bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/60"
          >
            <span className="font-mono">{AUTOMATIZE_PEOPLE_EMAIL}</span>
            <Copy className="size-3" />
          </button>
        ) : null}
        {report && !report.viewerHasCredential ? (
          <button
            type="button"
            onClick={() => void start("credential")}
            disabled={starting !== null}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {starting === "credential" ? "Abrindo…" : "Salvar meu Facebook para verificar"}
          </button>
        ) : null}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Conectar pelo portfólio</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Abre o login da Meta. Entre com o Facebook que tem acesso ao portfólio do
                  cliente (o de {AUTOMATIZE_PEOPLE_EMAIL}
                  {fullControl.length > 0
                    ? ` ou ${fullControl.map((p) => p.name ?? p.actorAdminEmail).join(", ")}`
                    : ""}
                  ), nunca com a senha do cliente.
                </p>
                <p>
                  Na tela de portfólios, escolha{" "}
                  <strong>{portfolioLabel ?? "o portfólio do cliente"}</strong> e marque a conta de
                  anúncios e a página dele. O cliente fica conectado sem fazer nada.
                </p>
                <p className="text-xs">
                  Se o cliente já tinha conta ou página registradas aqui e o portfólio escolhido não
                  tiver nenhuma delas, a conexão é recusada e nada muda.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void start("connect")}>Abrir a Meta</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function statusText(
  report: PortfolioAccessReport | null,
  portfolio: string | null,
  people: string[],
): string {
  if (!report) return "";
  const where = portfolio ? `O portfólio ${portfolio}` : "O portfólio do cliente";
  switch (report.status) {
    case "shared":
      return `${where} já está compartilhado com a Automatize (${people.join(", ")} com controle total). Conecte sem pedir nada ao cliente.`;
    case "partial":
      return `${where} aparece para a Automatize, mas sem controle total. Peça ao cliente para dar controle total em Pessoas, ou tente conectar.`;
    case "not_shared":
      return `Nenhum Facebook salvo da Automatize tem ${portfolio ? `o portfólio ${portfolio}` : "o portfólio do cliente"}. Peça ao cliente para convidar ${AUTOMATIZE_PEOPLE_EMAIL} em Pessoas com controle total — ou conecte se o seu Facebook tiver acesso.`;
    case "unknown_business":
      return `Não achamos o portfólio deste cliente entre os que os Facebooks salvos da Automatize enxergam. Se ele já convidou ${AUTOMATIZE_PEOPLE_EMAIL} em Pessoas, conecte e escolha o portfólio dele na Meta; se não, peça o convite.`;
    case "no_credentials":
      return "Nenhum Facebook da Automatize está salvo para verificar o acesso. Você ainda pode conectar.";
  }
}
