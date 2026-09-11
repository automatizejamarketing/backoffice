"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { formatBrazilianPhone, getWhatsAppUrl } from "@/lib/phone";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  CRM_COMMERCIAL_STATUS_VALUES,
  CRM_NOTE_MAX_LENGTH,
  CRM_STATUS_META,
  displayLeadName,
  type CrmCommercialStatus,
  type CrmLeadEventView,
} from "@/lib/backoffice/crm";
import {
  createCrmLeadNote,
  fetchCrmLead,
  formatDateTime,
  updateCrmLeadStatus,
  type CrmLeadDetailResponse,
} from "./crm-api";
import { AccountStageBadge, ProductTags } from "./crm-badges";

export function CrmLeadSheet({
  userId,
  onClose,
  onChanged,
}: {
  userId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <Sheet open={userId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
        {userId ? <LeadDetail userId={userId} onChanged={onChanged} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function LeadDetail({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const queryKey = ["crm", "lead", userId] as const;
  const query = useQuery({ queryKey, queryFn: () => fetchCrmLead(userId) });
  const [draft, setDraft] = useState("");

  const changeStatus = useMutation({
    mutationFn: (status: CrmCommercialStatus) => updateCrmLeadStatus(userId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      onChanged();
    },
  });

  const addNote = useMutation({
    mutationFn: (body: string) => createCrmLeadNote(userId, body),
    onSuccess: ({ event }) => {
      setDraft("");
      queryClient.setQueryData<CrmLeadDetailResponse>(queryKey, (current) =>
        current ? { ...current, events: [event, ...current.events] } : current,
      );
      onChanged();
    },
  });

  if (query.isError) {
    return (
      <div className="p-6 text-sm">
        <SheetHeader className="p-0">
          <SheetTitle className="sr-only">Lead</SheetTitle>
        </SheetHeader>
        Não deu para carregar o lead.{" "}
        <button type="button" className="font-medium underline" onClick={() => void query.refetch()}>
          Tentar de novo
        </button>
      </div>
    );
  }

  const data = query.data;
  if (!data) {
    return (
      <div className="space-y-3 p-6">
        <SheetHeader className="p-0">
          {/* Radix exige título mesmo enquanto carrega. */}
          <SheetTitle className="sr-only">Carregando lead</SheetTitle>
        </SheetHeader>
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="mt-6 h-32 w-full" />
      </div>
    );
  }

  const { lead, events } = data;
  const noteTooLong = draft.trim().length > CRM_NOTE_MAX_LENGTH;

  return (
    <>
      <SheetHeader>
        <SheetTitle>{displayLeadName(lead)}</SheetTitle>
        <SheetDescription className="flex flex-col gap-0.5">
          <span>
            {lead.companyName && lead.name ? `${lead.companyName} · ` : ""}
            {lead.email}
          </span>
          {lead.createdAt ? (
            <span>Conta criada em {formatDateTime(lead.createdAt)}</span>
          ) : null}
        </SheetDescription>
        <LeadPhone phone={lead.phone} />
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Status comercial</dt>
            <dd className="mt-1.5">
              <Select
                value={lead.commercialStatus}
                onValueChange={(value) => changeStatus.mutate(value as CrmCommercialStatus)}
                disabled={changeStatus.isPending}
              >
                <SelectTrigger aria-label="Status comercial" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRM_COMMERCIAL_STATUS_VALUES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {CRM_STATUS_META[status].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {CRM_STATUS_META[lead.commercialStatus].description}
              </p>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Conta</dt>
            <dd className="mt-1.5 flex flex-wrap items-center gap-2">
              <AccountStageBadge stage={lead.accountStage} />
              {lead.expirationDate ? (
                <span className="text-xs text-muted-foreground">
                  acesso até {formatDateTime(lead.expirationDate)}
                </span>
              ) : null}
            </dd>
            {lead.consultantName ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Consultor: {lead.consultantName}
              </p>
            ) : null}
          </div>
          {lead.productTitles.length > 0 ? (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">Produtos comprados</dt>
              <dd className="mt-1.5">
                <ProductTags titles={lead.productTitles} max={10} />
              </dd>
            </div>
          ) : null}
        </dl>

        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link href={`/users/${lead.id}`}>
            <ExternalLink />
            Abrir ficha completa
          </Link>
        </Button>

        <form
          className="mt-6 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const body = draft.trim();
            if (body && !noteTooLong) addNote.mutate(body);
          }}
        >
          <label htmlFor="crm-note" className="text-xs font-medium text-muted-foreground">
            Nova anotação
          </label>
          <Textarea
            id="crm-note"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Como foi o contato, o que ficou combinado…"
            rows={3}
            aria-invalid={noteTooLong}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">
              {noteTooLong
                ? `Passou de ${CRM_NOTE_MAX_LENGTH.toLocaleString("pt-BR")} caracteres.`
                : addNote.isError
                  ? addNote.error.message
                  : "Fica registrado com seu e-mail e a hora."}
            </span>
            <Button type="submit" size="sm" disabled={!draft.trim() || noteTooLong || addNote.isPending}>
              Salvar anotação
            </Button>
          </div>
        </form>

        <section aria-label="Histórico" className="mt-6">
          <h3 className="text-xs font-medium text-muted-foreground">Histórico</h3>
          {events.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nenhum contato registrado ainda.</p>
          ) : (
            <ol className="mt-2 space-y-3">
              {events.map((event) => (
                <EventItem key={event.id} event={event} />
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

/** Celular do lead: abre o WhatsApp num clique e copia no outro. */
function LeadPhone({ phone }: { phone: string | null }) {
  const formatted = formatBrazilianPhone(phone);
  const whatsappUrl = getWhatsAppUrl(phone);

  if (!formatted) {
    return <p className="text-sm text-muted-foreground">Sem celular cadastrado</p>;
  }

  async function copyPhone() {
    try {
      await navigator.clipboard.writeText(formatted as string);
      toast.success("Celular copiado");
    } catch {
      toast.error("Não foi possível copiar. Selecione o número manualmente.");
    }
  }

  return (
    <div className="flex items-center gap-1">
      {whatsappUrl ? (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-[#25D366] hover:underline"
          aria-label={`Abrir conversa no WhatsApp com ${formatted}`}
        >
          <WhatsAppIcon />
          {formatted}
        </a>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <WhatsAppIcon muted />
          {formatted}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Copiar celular"
        title="Copiar celular"
        onClick={() => void copyPhone()}
      >
        <Copy />
      </Button>
    </div>
  );
}

function EventItem({ event }: { event: CrmLeadEventView }) {
  return (
    <li className="rounded-lg border bg-background px-3 py-2">
      {event.kind === "status" && event.statusFrom && event.statusTo ? (
        <p className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">{CRM_STATUS_META[event.statusFrom].label}</span>
          <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{CRM_STATUS_META[event.statusTo].label}</span>
        </p>
      ) : (
        <p className="whitespace-pre-wrap text-sm">{event.body}</p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {event.authorEmail} · {formatDateTime(event.createdAt)}
      </p>
    </li>
  );
}
