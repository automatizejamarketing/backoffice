"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatShortDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import type { MetaAssetsResponse } from "@/lib/backoffice/meta-assets-types";
import { useMetaAssets } from "../hooks/use-meta-assets";
import { MetaAssetsLimitsForm } from "./meta-assets-limits-form";
import { MetaAssetsLists } from "./meta-assets-lists";
import { MetaTokenIssue } from "./meta-token-issue";
import { RequestMetaAssetSelectionDialog } from "./request-meta-asset-selection-dialog";

const REASON_LABEL = {
  initial: "inicial",
  limit_changed: "limite alterado",
  support_requested: "pedido do suporte",
} as const;

type MetaAssetsCardProps = {
  userId: string;
};

export function MetaAssetsCard({ userId }: MetaAssetsCardProps) {
  const query = useMetaAssets(userId);
  const [requestOpen, setRequestOpen] = useState(false);

  if (query.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ativos Meta</CardTitle>
          <CardDescription>Carregando estado da seleção…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ativos Meta</CardTitle>
          <CardDescription>
            Não foi possível carregar o card de Ativos Meta.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const data = query.data;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <CardTitle>Ativos Meta</CardTitle>
          <CardDescription>{selectionCopy(data)}</CardDescription>
        </div>
        {data.canEdit ? (
          <Button type="button" variant="outline" onClick={() => setRequestOpen(true)}>
            Pedir nova seleção
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6">
        {data.connection.status === "reconnect_required" ? (
          <MetaTokenIssue
            userId={userId}
            error={data.connection.error}
            onRetried={() => {
              void query.refetch();
            }}
          />
        ) : null}

        <MetaAssetsLimitsForm
          key={`${data.limits.adAccounts}-${data.limits.identities}`}
          userId={userId}
          canEdit={data.canEdit}
          adAccounts={data.limits.adAccounts}
          identities={data.limits.identities}
        />

        {data.connection.status === "active" && data.connection.listsError ? (
          <p className="text-sm text-muted-foreground">
            {data.connection.listsError}
          </p>
        ) : null}

        {data.granted && data.enabled ? (
          <MetaAssetsLists granted={data.granted} enabled={data.enabled} />
        ) : null}
      </CardContent>

      {data.canEdit ? (
        <RequestMetaAssetSelectionDialog
          userId={userId}
          open={requestOpen}
          onOpenChange={setRequestOpen}
        />
      ) : null}
    </Card>
  );
}

function selectionCopy(data: MetaAssetsResponse): string {
  if (data.connection.status === "never_connected") {
    return "Sem conexão Meta";
  }
  if (data.selection.status === "pending") {
    const reason = REASON_LABEL[data.selection.reason ?? "initial"];
    const since = data.selection.since
      ? ` desde ${formatShortDateTimeInSaoPaulo(data.selection.since)}`
      : "";
    const note =
      data.selection.reason === "support_requested" && data.selection.requestedNote
        ? ` — ${data.selection.requestedNote}`
        : "";
    return `Pendente${since} — ${reason}${note}`;
  }
  if (data.selection.status === "fixed") {
    const since = data.selection.since
      ? ` desde ${formatShortDateTimeInSaoPaulo(data.selection.since)}`
      : "";
    const mode = data.selection.mode === "implicit" ? "implícita" : "explícita";
    const who = data.selection.selectedBy ? ` (${data.selection.selectedBy})` : "";
    return `Fixa${since} — ${mode}${who}`;
  }
  if (data.connection.status === "reconnect_required") {
    return "Conexão Meta inválida — peça a reconexão antes de listar os ativos.";
  }
  return "Sem seleção";
}
