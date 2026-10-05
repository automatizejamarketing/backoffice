"use client";

import { useRef, type ReactNode } from "react";
import { ChevronLeft, Contact, Globe, Instagram, UsersRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CustomAudienceView } from "@/lib/meta-business/marketing/audiences/types";
import type { AudienceCreateKind, AudienceEditKind } from "./audience-kind";
import { AudienceMetadataEditor } from "./audience-metadata-editor";
import { CustomerListImport } from "./customer-list-import";
import { InstagramAudienceEditor } from "./instagram-audience-editor";
import { LookalikeAudienceCreator } from "./lookalike-audience-creator";
import { WebsiteAudienceEditor } from "./website-audience-editor";

export type AudienceWorkspaceState =
  | { view: "create-type" }
  | { view: "create"; kind: AudienceCreateKind }
  | { view: "edit"; audience: CustomAudienceView; kind: AudienceEditKind };

const CREATE_SOURCES: Array<{
  kind: AudienceCreateKind;
  title: string;
  description: string;
  icon: typeof Instagram;
}> = [
  {
    kind: "customer",
    title: "Lista de clientes",
    description: "Importe e-mails ou telefones de um arquivo CSV ou XLSX.",
    icon: Contact,
  },
  {
    kind: "instagram",
    title: "Instagram",
    description: "Pessoas que interagiram com o perfil do negócio.",
    icon: Instagram,
  },
  {
    kind: "website",
    title: "Site",
    description: "Visitantes e eventos registrados pelo pixel.",
    icon: Globe,
  },
  {
    kind: "lookalike",
    title: "Público semelhante",
    description: "Pessoas parecidas com um público que você já tem.",
    icon: UsersRound,
  },
];

function workspaceCopy(state: AudienceWorkspaceState) {
  if (state.view === "create-type") {
    return {
      title: "Criar público",
      description: "Escolha a origem. A regra só é definida no passo seguinte.",
    };
  }
  if (state.view === "edit") {
    const titles: Record<AudienceEditKind, string> = {
      customer: "Atualizar lista de clientes",
      instagram: "Editar público do Instagram",
      website: "Editar público do site",
      metadata: "Editar público",
    };
    return {
      title: titles[state.kind],
      description: state.audience.name ?? state.audience.id,
    };
  }
  const titles: Record<AudienceCreateKind, string> = {
    customer: "Criar lista de clientes",
    instagram: "Criar público do Instagram",
    website: "Criar público do site",
    lookalike: "Criar público semelhante",
  };
  return {
    title: titles[state.kind],
    description: "Defina o público na biblioteca da conta. Isso não altera o direcionamento de uma campanha.",
  };
}

function AudienceWorkspaceBody({
  accountId,
  userId,
  audiences,
  state,
  onSelectKind,
  onSaved,
}: {
  accountId: string;
  userId: string;
  audiences: CustomAudienceView[];
  state: AudienceWorkspaceState;
  onSelectKind: (kind: AudienceCreateKind) => void;
  onSaved: () => void;
}) {
  if (state.view === "create-type") {
    return (
      <ul className="grid gap-3 @min-[30rem]:grid-cols-2">
        {CREATE_SOURCES.map((source) => {
          const Icon = source.icon;
          return (
            <li key={source.kind}>
              <button
                className={cn(
                  "flex h-full w-full gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors",
                  "hover:border-primary/50 hover:bg-primary/5",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
                onClick={() => onSelectKind(source.kind)}
                type="button"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold">{source.title}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{source.description}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  if (state.view === "edit") {
    if (state.kind === "instagram") {
      return (
        <InstagramAudienceEditor
          accountId={accountId} userId={userId}
          audience={state.audience}
          chrome="plain"
          onSaved={onSaved}
        />
      );
    }
    if (state.kind === "website") {
      return (
        <WebsiteAudienceEditor
          accountId={accountId} userId={userId}
          audience={state.audience}
          chrome="plain"
          onSaved={onSaved}
        />
      );
    }
    if (state.kind === "customer") {
      return (
        <CustomerListImport
          accountId={accountId} userId={userId}
          audiences={audiences}
          chrome="plain"
          defaultAudienceId={state.audience.id}
          defaultOperation="add"
          onChanged={onSaved}
        />
      );
    }
    return (
      <AudienceMetadataEditor
        accountId={accountId} userId={userId}
        audience={state.audience}
        chrome="plain"
        onSaved={onSaved}
      />
    );
  }

  if (state.kind === "instagram") {
    return <InstagramAudienceEditor accountId={accountId} userId={userId} chrome="plain" onSaved={onSaved} />;
  }
  if (state.kind === "website") {
    return <WebsiteAudienceEditor accountId={accountId} userId={userId} chrome="plain" onSaved={onSaved} />;
  }
  if (state.kind === "customer") {
    return (
      <CustomerListImport
        accountId={accountId} userId={userId}
        audiences={audiences}
        chrome="plain"
        onChanged={onSaved}
      />
    );
  }
  return (
    <LookalikeAudienceCreator
      accountId={accountId} userId={userId}
      audiences={audiences}
      chrome="plain"
      onSaved={onSaved}
    />
  );
}

function AudienceWorkspaceFrame({
  copy,
  onBack,
  onClose,
  children,
}: {
  copy: { title: string; description: string };
  onBack?: () => void;
  onClose?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="@container flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-start gap-3 border-b border-border pb-4 pr-8">
        {onBack ? (
          <Button
            aria-label="Voltar"
            className="mt-0.5 shrink-0"
            onClick={onBack}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronLeft />
          </Button>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{copy.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
        </div>
        {onClose ? <Button aria-label="Fechar público" className="ml-auto shrink-0" onClick={onClose} size="icon" type="button" variant="ghost"><X /></Button> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pt-5">{children}</div>
    </div>
  );
}

export function AudienceWorkspace({
  accountId,
  userId,
  audiences,
  state,
  surface,
  onClose,
  onBackToTypes,
  onSelectKind,
  onSaved,
}: {
  accountId: string;
  userId: string;
  audiences: CustomAudienceView[];
  state: AudienceWorkspaceState | null;
  surface: "dialog" | "inline";
  onClose: () => void;
  onBackToTypes: () => void;
  onSelectKind: (kind: AudienceCreateKind) => void;
  onSaved: () => void;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  if (!state) return null;
  const copy = workspaceCopy(state);
  const backToTypes = state.view === "create" ? onBackToTypes : undefined;
  const body = (
    <AudienceWorkspaceBody
      key={`${userId}:${accountId}:${state.view}:${state.view === "create-type" ? "types" : state.kind}:${state.view === "edit" ? state.audience.id : "new"}`}
      accountId={accountId} userId={userId}
      audiences={audiences}
      onSaved={onSaved}
      onSelectKind={onSelectKind}
      state={state}
    />
  );

  if (surface === "inline") {
    return (
      <AudienceWorkspaceFrame copy={copy} onBack={backToTypes ?? onClose} onClose={onClose}>
        {body}
      </AudienceWorkspaceFrame>
    );
  }

  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open>
      <DialogContent showCloseButton={false}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); } }}
        className="flex h-[100dvh] max-h-[100dvh] w-[100vw] max-w-none sm:w-full flex-col gap-0 overflow-hidden rounded-none p-4 sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-lg sm:p-6">
        <DialogClose asChild><Button aria-label="Fechar público" className="absolute right-3 top-3" size="icon" type="button" variant="ghost"><X /></Button></DialogClose>
        <DialogHeader className="sr-only">
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <AudienceWorkspaceFrame copy={copy} onBack={backToTypes}>
          {body}
        </AudienceWorkspaceFrame>
      </DialogContent>
    </Dialog>
  );
}
