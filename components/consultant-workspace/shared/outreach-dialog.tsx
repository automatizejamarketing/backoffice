"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, Loader2, Phone, Send, ThumbsUp, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/consultant-workspace/metrics";
import {
  OUTREACH_KIND_LABEL,
  OUTREACH_MESSAGE_MAX,
  OUTREACH_TITLE_MAX,
  RECIPIENT_SOURCE_LABEL,
  type OutreachErrorCode,
  type OutreachResult,
} from "@/lib/consultant-workspace/outreach-core";
import type { MatDraft } from "@/lib/consultant-workspace/playbook-actions";
import { WORKSPACE_STATE_KEY } from "./use-workspace-state";

type Failure = { code: OutreachErrorCode | string; message: string; lastSentAt?: string | null };

async function callOutreach(mode: "preview" | "send", body: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch("/api/consultant-workspace/outreach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, ...body }),
    signal,
  });
  const payload = (await response.json().catch(() => null)) as (OutreachResult & { error?: string; message?: string; lastSentAt?: string | null }) | null;
  if (!response.ok || !payload || payload.ok !== true) {
    const failure: Failure = {
      code: payload?.error ?? "unexpected",
      message: payload?.message ?? payload?.error ?? `Falha (${response.status})`,
      lastSentAt: payload?.lastSentAt ?? null,
    };
    throw failure;
  }
  return payload as OutreachResult;
}

/**
 * Mandar pela Mat (WhatsApp da Automatize): o gestor edita título e texto,
 * vê a prévia real do app (para quem vai, como chega, botão) e confirma.
 * A mensagem chega de verdade ao cliente — por isso a confirmação em dois
 * passos. O "Abrir no WhatsApp" do seu número continua no botão Mensagem.
 */
export function OutreachDialog({
  open,
  onOpenChange,
  userId,
  clientName,
  draft,
  lastMatSentAt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  clientName: string;
  draft: MatDraft | null;
  /** Último envio da Mat deste tipo para o cliente (linha do tempo), para avisar antes. */
  lastMatSentAt?: string | null;
}) {
  return (
    <Dialog open={open && draft != null} onOpenChange={onOpenChange}>
      {open && draft ? (
        <OutreachBody
          key={`${draft.kind}-${draft.entity?.id ?? ""}-${draft.title}`}
          userId={userId}
          clientName={clientName}
          draft={draft}
          lastMatSentAt={lastMatSentAt ?? null}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

function OutreachBody({
  userId,
  clientName,
  draft,
  lastMatSentAt,
  onClose,
}: {
  userId: string;
  clientName: string;
  draft: MatDraft;
  lastMatSentAt: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(draft.title);
  const [message, setMessage] = useState(draft.message);
  const [preview, setPreview] = useState<{ result: OutreachResult; title: string; message: string } | null>(null);
  const [previewError, setPreviewError] = useState<Failure | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<Failure | null>(null);

  const titleTrim = title.trim();
  const messageTrim = message.trim();
  const titleInvalid = !titleTrim || titleTrim.length > OUTREACH_TITLE_MAX || /[\r\n]/.test(title);
  const messageInvalid = !messageTrim || messageTrim.length > OUTREACH_MESSAGE_MAX;
  const invalid = titleInvalid || messageInvalid;
  const body = { userId, kind: draft.kind, title: titleTrim, message: messageTrim, ...(draft.entity ? { entity: draft.entity } : {}) };

  // Prévia ao vivo: o app renderiza o template e diz para quem vai. Espera a digitação parar.
  useEffect(() => {
    if (invalid) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewing(true);
      try {
        const result = await callOutreach("preview", body, controller.signal);
        setPreview({ result, title: titleTrim, message: messageTrim });
        setPreviewError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        setPreview(null);
        setPreviewError(error as Failure);
      } finally {
        if (!controller.signal.aborted) setPreviewing(false);
      }
    }, 700);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // `body` muda junto com estes campos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleTrim, messageTrim, invalid, userId, draft.kind, draft.entity?.id]);

  const fresh = preview && preview.title === titleTrim && preview.message === messageTrim;
  const recipient = preview?.result.recipient;
  const canSend = !invalid && fresh && recipient?.available && !previewing;

  async function send() {
    setSending(true);
    setSendError(null);
    try {
      const result = await callOutreach("send", body);
      toast.success(`Mat enviou para ${result.recipient.masked ?? clientName}`);
      await queryClient.invalidateQueries({ queryKey: WORKSPACE_STATE_KEY });
      onClose();
    } catch (error) {
      setSendError(error as Failure);
      setStep("edit");
    } finally {
      setSending(false);
    }
  }

  return (
    <DialogContent className="gap-3 sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Bot className="size-4 text-violet-600 dark:text-violet-400" /> Mandar pela Mat (WhatsApp da Automatize)
        </DialogTitle>
        <DialogDescription>
          {OUTREACH_KIND_LABEL[draft.kind]} para {clientName}. A Mat manda do WhatsApp da Automatize — chega de verdade
          no cliente.
          {lastMatSentAt ? (
            <span className="mt-1 block text-amber-700 dark:text-amber-400">
              A Mat já mandou uma mensagem deste tipo {formatRelative(lastMatSentAt)}.
            </span>
          ) : null}
        </DialogDescription>
      </DialogHeader>

      {step === "edit" ? (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="outreach-title" className="text-xs text-muted-foreground">
                  Título (uma linha)
                </Label>
                <Counter value={titleTrim.length} max={OUTREACH_TITLE_MAX} />
              </div>
              <Input id="outreach-title" value={title} onChange={(event) => setTitle(event.target.value.replace(/[\r\n]+/g, " "))} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="outreach-message" className="text-xs text-muted-foreground">
                  Mensagem (pode editar)
                </Label>
                <Counter value={messageTrim.length} max={OUTREACH_MESSAGE_MAX} />
              </div>
              <Textarea
                id="outreach-message"
                rows={9}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                className="text-sm leading-relaxed"
              />
            </div>
          </div>
          <PreviewPane
            kind={draft.kind}
            previewing={previewing || (!invalid && !fresh && !previewError)}
            preview={fresh ? preview!.result : null}
            error={invalid ? null : previewError}
            invalid={invalid}
          />
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3 text-sm dark:border-violet-900 dark:bg-violet-950/30">
          <p className="font-medium">
            A Mat vai mandar agora para {recipient?.masked ?? clientName}
            {recipient?.source ? <span className="font-normal text-muted-foreground"> ({RECIPIENT_SOURCE_LABEL[recipient.source]})</span> : null}:
          </p>
          <p className="font-medium">{preview?.result.rendered.title}</p>
          <p className="whitespace-pre-line text-muted-foreground">{preview?.result.rendered.message}</p>
          <p className="text-xs text-muted-foreground">Não dá para desfazer depois de enviada. Fica registrado no histórico do cliente.</p>
        </div>
      )}

      {sendError ? <FailureBox failure={sendError} /> : null}

      <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] text-muted-foreground sm:max-w-xs">
          Quer mandar do seu número? Use o botão “Mensagem” do cliente (Abrir no WhatsApp).
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          {step === "edit" ? (
            <>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancelar
              </Button>
              <Button size="sm" onClick={() => setStep("confirm")} disabled={!canSend}>
                <Send className="size-3.5" /> Enviar pela Mat
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setStep("edit")} disabled={sending}>
                Voltar
              </Button>
              <Button size="sm" onClick={send} disabled={sending}>
                {sending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                {sending ? "Enviando…" : "Confirmar envio"}
              </Button>
            </>
          )}
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <span className={cn("text-[11px] tabular-nums", value > max ? "font-medium text-red-700 dark:text-red-400" : "text-muted-foreground")}>
      {value}/{max}
    </span>
  );
}

function FailureBox({ failure }: { failure: Failure }) {
  const recent = failure.code === "recently_sent";
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        recent
          ? "border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200"
          : "border-red-300/70 bg-red-50 text-red-900 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-200",
      )}
    >
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>{failure.message}</span>
    </div>
  );
}

function PreviewPane({
  kind,
  previewing,
  preview,
  error,
  invalid,
}: {
  kind: MatDraft["kind"];
  previewing: boolean;
  preview: OutreachResult | null;
  error: Failure | null;
  invalid: boolean;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Como chega no WhatsApp {previewing ? <Loader2 className="size-3 animate-spin" /> : null}
      </p>
      {invalid ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
          Preencha título (até {OUTREACH_TITLE_MAX}) e mensagem (até {OUTREACH_MESSAGE_MAX}) para ver a prévia.
        </p>
      ) : error ? (
        <FailureBox failure={error} />
      ) : preview ? (
        <div className="space-y-2">
          <div className="rounded-lg rounded-tl-none bg-emerald-50 px-3 py-2 text-[13px] leading-relaxed text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-50">
            <p className="font-medium">{preview.rendered.title}</p>
            <p className="mt-1 whitespace-pre-line">{preview.rendered.message}</p>
            {preview.rendered.buttonUrl ? (
              <p className="mt-2 truncate border-t border-emerald-200/70 pt-1.5 text-center text-xs font-medium text-sky-700 dark:border-emerald-900 dark:text-sky-300" title={preview.rendered.buttonUrl}>
                Botão → {preview.rendered.buttonUrl}
              </p>
            ) : null}
          </div>
          {preview.recipient.available ? (
            <p className="flex flex-wrap items-center gap-1 text-xs">
              <Phone className="size-3" /> Para {preview.recipient.masked ?? "o cliente"}
              {preview.recipient.source ? <span className="text-muted-foreground">· {RECIPIENT_SOURCE_LABEL[preview.recipient.source]}</span> : null}
            </p>
          ) : (
            <FailureBox failure={{ code: "no_recipient", message: "O cliente não tem WhatsApp para a Mat mandar. Use “Abrir no WhatsApp” no botão Mensagem." }} />
          )}
          {kind === "scale_approval" ? (
            preview.approval.available ? (
              <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                <ThumbsUp className="size-3" /> O cliente aprova no app com um toque
                {preview.approval.actionLabel ? ` (“${preview.approval.actionLabel}”)` : ""}.
              </p>
            ) : (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                O app não confirmou o botão de aprovação desta campanha — o cliente vai receber só o aviso.
              </p>
            )
          ) : null}
          {preview.rendered.template ? <p className="text-[10px] text-muted-foreground">Template {preview.rendered.template}</p> : null}
        </div>
      ) : (
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
      )}
    </div>
  );
}
