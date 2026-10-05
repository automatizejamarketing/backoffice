"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  CertificationDiagnostic,
  TokenDiagnostic,
} from "@/lib/meta-business/certification-diagnostic";

function verdict(token: TokenDiagnostic): { text: string; tone: string } {
  const call = token.validateOnlyAd;
  if (call.skipped) return { text: `Não testado: ${call.skipped}`, tone: "text-muted-foreground" };
  if (token.certificationRefused) {
    return {
      text: "Recusado por certificação (100/2859024): este token não publica nesta conta.",
      tone: "text-red-600",
    };
  }
  if (call.ok) {
    return {
      text: "Aceito pela Meta no validate_only: este token publicaria o anúncio.",
      tone: "text-emerald-600",
    };
  }
  return {
    text: `Outro erro (${call.code ?? "?"}/${call.subcode ?? "-"}): ${call.message ?? "sem mensagem"}`,
    tone: "text-amber-600",
  };
}

/**
 * Asks Meta, without creating anything, whether this client's ad account
 * refuses new ads for the non-discrimination certification — with the client
 * token and with each stored consultant token.
 */
export function CertificationDiagnosticPanel({ userId }: { userId: string }) {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<CertificationDiagnostic | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/users/${userId}/meta-account/certification-diagnostic`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => null)) as
        | (CertificationDiagnostic & { message?: string })
        | null;
      if (!res.ok || !body?.tokens) {
        setResult(null);
        setError(body?.message ?? "Não foi possível rodar o teste.");
      } else {
        setResult(body);
      }
    } catch {
      setError("Não foi possível rodar o teste.");
    }
    setIsRunning(false);
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Certificação Meta</Badge>
        <p className="text-sm text-muted-foreground">
          Pergunta à Meta se esta conta recusa anúncios por certificação. Usa
          validate_only: nada é criado nem publicado.
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={run} disabled={isRunning}>
        {isRunning ? "Testando..." : "Testar certificação Meta"}
      </Button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {result ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Conta {result.adAccountId} · conjunto {result.adSetId ?? "—"} ·
            criativo {result.creativeId ?? "—"}
          </p>
          <ul className="space-y-2">
            {result.tokens.map((token) => {
              const v = verdict(token);
              return (
                <li key={`${token.label}-${token.identity}`} className="rounded border border-border p-2">
                  <p className="font-medium text-foreground">
                    {token.label} <span className="text-muted-foreground">({token.identity})</span>
                  </p>
                  <p className="text-muted-foreground">
                    Conta:{" "}
                    {token.account.ok
                      ? `acessível, status ${token.account.accountStatus ?? "?"}${token.account.businessName ? `, BM ${token.account.businessName}` : ""}`
                      : `sem acesso (${token.account.code ?? "?"}/${token.account.subcode ?? "-"}) ${token.account.message ?? ""}`}
                  </p>
                  <p className={v.tone}>{v.text}</p>
                </li>
              );
            })}
          </ul>
          {result.tokens.length === 1 ? (
            <p className="text-muted-foreground">
              Nenhum consultor tem o Facebook pessoal conectado, então só o
              token do cliente foi testado.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
