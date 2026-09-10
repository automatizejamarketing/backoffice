"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CustomAudienceView } from "@/lib/meta-business/marketing/audiences/types";

type Review = {
  ok: true;
  before: { name?: string; description?: string };
  after: { name?: string; description?: string };
  confirmationToken: string;
  commandId: string;
  impact: {
    knownUses: Array<{
      campaignId?: string;
      campaignName?: string;
      adSetId: string;
      adSetName?: string;
      placement: "include" | "exclude";
    }>;
    dependentAudienceIds: string[];
    coverage: "complete" | "incomplete";
    limitations: string[];
  };
};

type AudienceMetadataEditorProps = {
  audience: CustomAudienceView;
  accountId: string;
  userId: string;
  onSaved: () => void;
};

export function AudienceMetadataEditor({
  audience,
  accountId,
  userId,
  onSaved,
}: AudienceMetadataEditorProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(audience.name ?? "");
  const [description, setDescription] = useState(audience.description ?? "");
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reconciliationRequired, setReconciliationRequired] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(audience.name ?? "");
    setDescription(audience.description ?? "");
    setReview(null);
    setError(null);
  }, [audience.description, audience.name, open]);

  const request = async (
    action: "review" | "confirm" | "reconcile",
    confirmationToken?: string,
    commandId?: string,
  ) => {
    setError(null);
    setSaving(true);
    const changes = {
      ...(name !== (audience.name ?? "") ? { name } : {}),
      ...(description !== (audience.description ?? "") ? { description } : {}),
    };
    try {
      const response = await fetch(
        `/api/meta-marketing/${accountId}/audiences?userId=${encodeURIComponent(userId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            audienceId: audience.id,
            ...changes,
            confirmationToken,
            commandId,
          }),
        },
      );
      const result = (await response.json()) as Review & {
        error?: string;
        message?: string;
        state?: "reconciliation_required";
        issues?: Array<{ reason?: string; suggestion?: string }>;
      };
      if (!response.ok || !result.ok) {
        if (result.state === "reconciliation_required") setReconciliationRequired(true);
        setError(
          result.message ??
            result.error ??
            result.issues?.[0]?.reason ??
            "Não foi possível revisar a alteração.",
        );
        return;
      }
      if (action === "review") {
        setReview(result);
        setReconciliationRequired(false);
      } else {
        setOpen(false);
        setReview(null);
        onSaved();
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível revisar a alteração.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          Editar metadados
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {review ? "Revise a alteração" : "Editar metadados do público"}
          </DialogTitle>
          <DialogDescription>
            {review
              ? `Público ${audience.name ?? audience.id} na conta ${accountId}.`
              : "A regra do público não será alterada."}
          </DialogDescription>
        </DialogHeader>
        {!review ? (
          <div className="space-y-3">
            <label className="grid gap-1 text-sm">
              Nome
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              Descrição
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <Button type="button" disabled={saving} onClick={() => { request("review"); }}>
              Revisar alteração
            </Button>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              <strong>Antes:</strong> {review.before.name ?? "Sem nome"} —{" "}
              {review.before.description ?? "Sem descrição"}
            </p>
            <p>
              <strong>Depois:</strong> {review.after.name ?? "Sem nome"} —{" "}
              {review.after.description ?? "Sem descrição"}
            </p>
            <div>
              <p>Usos conhecidos:</p>
              {review.impact.knownUses.length ? (
                <ul className="list-disc pl-5">
                  {review.impact.knownUses.map((use) => (
                    <li key={`${use.adSetId}:${use.placement}`}>
                      {use.placement === "include" ? "Inclusão" : "Exclusão"}: {use.campaignName ?? use.campaignId ?? "Campanha não informada"} / {use.adSetName ?? use.adSetId}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Nenhum uso conhecido nesta página.</p>
              )}
            </div>
            <p>Dependências lookalike: {review.impact.dependentAudienceIds.length}.</p>
            <p role="status">
              Cobertura do inventário: {review.impact.coverage}. {" "}
              {review.impact.limitations.join(" ")}
            </p>
            {reconciliationRequired ? (
              <Button type="button" disabled={saving} onClick={() => { request("reconcile", review.confirmationToken, review.commandId); }}>
                Reconciliar resultado
              </Button>
            ) : (
              <Button type="button" disabled={saving} onClick={() => { request("confirm", review.confirmationToken, review.commandId); }}>
                Confirmar alteração
              </Button>
            )}
          </div>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
