"use client";

import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdCreativeBuilderPhase } from "./use-ad-creative-builder";

type StepStatus = "complete" | "active" | "pending" | "error";

function StepItem({
  title,
  description,
  status,
}: {
  title: string;
  description: string;
  status: StepStatus;
}) {
  const icon =
    status === "complete" ? (
      <CheckCircle2 className="size-5 text-emerald-500" />
    ) : status === "active" ? (
      <Loader2 className="size-5 animate-spin text-primary" />
    ) : status === "error" ? (
      <XCircle className="size-5 text-destructive" />
    ) : (
      <CircleDashed className="size-5 text-muted-foreground" />
    );

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

type AdMediaProcessingCardProps = {
  phase: AdCreativeBuilderPhase;
  isVideo: boolean;
  isEdit: boolean;
  videoProgress: number | null;
  errorMessage?: string | null;
};

export function AdMediaProcessingCard({
  phase,
  isVideo,
  isEdit,
  videoProgress,
  errorMessage,
}: AdMediaProcessingCardProps) {
  const creativeStatus: StepStatus =
    phase === "error"
      ? "error"
      : phase === "submitting"
        ? "active"
        : phase === "processing" || phase === "done"
          ? "complete"
          : "pending";

  const processingStatus: StepStatus = !isVideo
    ? "complete"
    : phase === "processing"
      ? "active"
      : phase === "done"
        ? "complete"
        : phase === "error"
          ? "error"
          : "pending";

  const finalStatus: StepStatus =
    phase === "done"
      ? "complete"
      : phase === "error"
        ? "error"
        : phase === "processing" || phase === "submitting"
          ? "active"
          : "pending";

  return (
    <div className="flex flex-col gap-3">
      <StepItem
        title="Criativo"
        description="Envio da mídia e criação do criativo na Meta."
        status={creativeStatus}
      />
      {isVideo && (
        <StepItem
          title="Processamento do vídeo"
          description={
            phase === "processing"
              ? `A Meta está processando o vídeo${
                  typeof videoProgress === "number"
                    ? ` (${videoProgress}%)`
                    : ""
                }...`
              : "A Meta processa o vídeo antes de publicar o anúncio."
          }
          status={processingStatus}
        />
      )}
      <StepItem
        title={isEdit ? "Atualização do anúncio" : "Anúncio"}
        description={
          isEdit
            ? "Aplicação do novo criativo ao anúncio."
            : "Criação do anúncio no conjunto selecionado."
        }
        status={finalStatus}
      />

      {phase === "error" && errorMessage && (
        <p
          className={cn(
            "rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive",
          )}
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
}
