"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronRight,
  Globe,
  MessageSquare,
  Scissors,
  Smartphone,
  Wrench,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ActionStatus,
  TranscriptItem,
} from "@/lib/backoffice/conversation-transcript";
import type {
  ConversationChannel,
  ConversationListItem,
} from "@/lib/db/conversation-queries";
import { cn } from "@/lib/utils";

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeStyle: "short",
});

const CHANNEL_LABEL: Record<ConversationChannel, string> = {
  web: "App",
  whatsapp: "WhatsApp",
};

const CHANNEL_ICON: Record<ConversationChannel, typeof Globe> = {
  web: Globe,
  whatsapp: Smartphone,
};

const ACTION_STATUS: Record<
  ActionStatus,
  { label: string; icon: typeof Check; className: string }
> = {
  pending: {
    label: "sem desfecho",
    icon: AlertTriangle,
    className: "text-muted-foreground",
  },
  completed: { label: "executada", icon: Check, className: "text-emerald-600 dark:text-emerald-400" },
  failed: { label: "falhou", icon: X, className: "text-destructive" },
  rejected: { label: "negada pelo usuário", icon: Ban, className: "text-amber-600 dark:text-amber-400" },
};

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}

/** Collapsed by default: raw payloads are for forensics, not for reading. */
function Collapsible({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        {label}
      </button>
      {open && (
        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted/60 p-3 text-xs leading-relaxed text-foreground/90">
          {children}
        </pre>
      )}
    </div>
  );
}

function ActionCard({ item }: { item: Extract<TranscriptItem, { kind: "action" }> }) {
  const status = ACTION_STATUS[item.status];
  const StatusIcon = status.icon;

  return (
    <div className="rounded-lg border border-border bg-card/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Wrench className="size-4 text-muted-foreground" />
        <code className="text-sm font-medium text-foreground">{item.toolName}</code>
        <span className={cn("inline-flex items-center gap-1 text-xs", status.className)}>
          <StatusIcon className="size-3.5" />
          {status.label}
        </span>
        {item.approvalRequested && (
          <Badge variant="outline" className="text-[10px]">
            pediu confirmação
          </Badge>
        )}
        {item.truncated && (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Scissors className="size-3" />
            payload truncado
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {timeFormatter.format(item.at)}
        </span>
      </div>

      {item.error?.message && (
        <p className="mt-2 text-xs text-destructive">
          {item.error.code ? `[${item.error.code}] ` : ""}
          {item.error.message}
        </p>
      )}

      <div className="mt-2 space-y-2">
        <Collapsible label="argumentos">{formatJson(item.input)}</Collapsible>
        {"output" in item && (
          <Collapsible label="resultado">{formatJson(item.output)}</Collapsible>
        )}
      </div>
    </div>
  );
}

function TranscriptRow({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "user-message":
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-lg rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
            <p className="whitespace-pre-wrap break-words">{item.text}</p>
            <p className="mt-1 text-right text-[10px] opacity-70">
              {timeFormatter.format(item.at)}
            </p>
          </div>
        </div>
      );

    case "assistant-message":
      return (
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-lg rounded-bl-sm bg-muted px-4 py-2 text-sm text-foreground">
            <p className="whitespace-pre-wrap break-words">{item.text}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Mat • {timeFormatter.format(item.at)}
            </p>
          </div>
        </div>
      );

    case "action":
      return <ActionCard item={item} />;

    case "client-context":
      return (
        <div className="px-1">
          <Collapsible label={`contexto do app • ${timeFormatter.format(item.at)}`}>
            {formatJson(item.data)}
          </Collapsible>
        </div>
      );

    case "turn-failed":
      return (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          <span>{item.message}</span>
          <span className="ml-auto opacity-70">{timeFormatter.format(item.at)}</span>
        </div>
      );

    default:
      return null;
  }
}

function ConversationRow({
  conversation,
  userId,
  active,
}: {
  conversation: ConversationListItem;
  userId: string;
  active: boolean;
}) {
  const Icon = CHANNEL_ICON[conversation.channel];
  return (
    <Link
      href={`/users/${userId}?tab=conversations&conversation=${conversation.id}`}
      className={cn(
        "block w-full rounded-lg border px-3 py-2 text-left transition-colors",
        active
          ? "border-primary bg-muted"
          : "border-border hover:border-primary/40 hover:bg-muted/50",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {CHANNEL_LABEL[conversation.channel]}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {conversation.messageCount} msg
        </span>
      </div>
      <p className="mt-1 truncate text-sm font-medium text-foreground">
        {conversation.title ?? "(sem mensagem do usuário)"}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {dateTimeFormatter.format(conversation.lastEventAt)}
      </p>
    </Link>
  );
}

export function ConversationsTab({
  userId,
  conversations,
  selectedConversation,
  transcript,
}: {
  userId: string;
  conversations: ConversationListItem[];
  selectedConversation: ConversationListItem | null;
  transcript: TranscriptItem[];
}) {
  if (conversations.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <MessageSquare className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            Nenhuma conversa registrada
          </p>
          <p className="max-w-md text-xs text-muted-foreground">
            O histórico começa quando o usuário conversa com o Mat — no app ou no
            WhatsApp. Conversas anteriores ao registro não existem.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(240px,320px)_1fr]">
      <Card className="h-fit">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Conversas ({conversations.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="max-h-[70vh] space-y-2 overflow-y-auto">
          {conversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              userId={userId}
              active={conversation.id === selectedConversation?.id}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {selectedConversation?.title ?? "Conversa"}
            {selectedConversation && (
              <Badge variant="secondary" className="text-[10px]">
                {CHANNEL_LABEL[selectedConversation.channel]}
              </Badge>
            )}
          </CardTitle>
          {selectedConversation && (
            <p className="text-xs text-muted-foreground">
              Início {dateTimeFormatter.format(selectedConversation.startedAt)} • última
              atividade {dateTimeFormatter.format(selectedConversation.lastEventAt)}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {transcript.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Esta conversa não tem eventos legíveis.
            </p>
          ) : (
            <div className="space-y-3">
              {transcript.map((item) => (
                <TranscriptRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
