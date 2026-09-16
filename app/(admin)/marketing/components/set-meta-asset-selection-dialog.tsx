"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  metaAssetSelectionErrorCopy,
} from "@/lib/backoffice/meta-asset-mutation-plan";
import {
  canAdvanceSelectionStep,
  draftToProposal,
  toSelectionSubmitBody,
  toggleChosenId,
  visibleSelectionSteps,
  type SelectionDraft,
} from "@/lib/backoffice/meta-asset-selection-steps";
import {
  prefillSelection,
  validateSelection,
  withImplicitPrimaries,
} from "@/lib/meta-business/meta-asset-policy";
import { cn } from "@/lib/utils";
import type { MetaAssetsResponse } from "@/lib/backoffice/meta-assets-types";
import {
  MetaAssetSelectionSetError,
  useSetMetaAssetSelection,
} from "../hooks/use-meta-assets";

const STEP_LABEL = {
  ad_accounts: "Contas de anúncios",
  identities: "Identidades",
  primaries: "Principais",
  confirm: "Confirmação",
} as const;

type Granted = NonNullable<MetaAssetsResponse["granted"]>;
type Enabled = NonNullable<MetaAssetsResponse["enabled"]>;

type SetMetaAssetSelectionDialogProps = {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limits: MetaAssetsResponse["limits"];
  granted: Granted;
  enabled: Enabled;
};

export function SetMetaAssetSelectionDialog({
  userId,
  open,
  onOpenChange,
  limits,
  granted,
  enabled,
}: SetMetaAssetSelectionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Definir seleção</DialogTitle>
          <DialogDescription>
            As mesmas etapas do modal do usuário, validadas contra os
            concedidos ao vivo.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <SelectionWizard
            userId={userId}
            limits={limits}
            granted={granted}
            enabled={enabled}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SelectionWizard({
  userId,
  limits,
  granted,
  enabled,
  onDone,
}: {
  userId: string;
  limits: MetaAssetsResponse["limits"];
  granted: Granted;
  enabled: Enabled;
  onDone: () => void;
}) {
  const submit = useSetMetaAssetSelection(userId);
  const prefill = prefillSelection({
    previouslyEnabled: [
      ...enabled.adAccounts.map((account) => ({
        id: account.id,
        kind: "ad_account" as const,
        isPrimary: account.primary,
      })),
      ...enabled.identities.map((identity) => ({
        id: identity.id,
        kind: "identity" as const,
        isPrimary: identity.primary,
      })),
    ],
    granted: {
      adAccountIds: granted.adAccounts.map((account) => account.id),
      identityIds: granted.identities.map((identity) => identity.pageId),
    },
    limits,
  });
  const [draft, setDraft] = useState<SelectionDraft>({
    adAccountIds: prefill.adAccountIds,
    identityPageIds: prefill.identityIds,
    primaryAdAccountId: prefill.primaryAdAccountId,
    primaryIdentityPageId: prefill.primaryIdentityId,
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [alert, setAlert] = useState<string | null>(null);

  const grantedIds = useMemo(
    () => ({
      adAccountIds: granted.adAccounts.map((account) => account.id),
      identityIds: granted.identities.map((identity) => identity.pageId),
    }),
    [granted],
  );
  const proposal = draftToProposal(draft);
  const steps = visibleSelectionSteps(proposal);
  const currentStep =
    steps[Math.min(stepIndex, steps.length - 1)] ?? "ad_accounts";
  const canAdvance = canAdvanceSelectionStep({
    step: currentStep,
    proposal,
    granted: grantedIds,
    limits,
  });
  const validation = validateSelection({
    proposal: withImplicitPrimaries(proposal),
    granted: grantedIds,
    limits,
  });
  const stepAlert = (() => {
    if (currentStep !== "primaries" && currentStep !== "confirm") {
      return null;
    }
    if (validation.ok) {
      return null;
    }
    const copy = metaAssetSelectionErrorCopy(validation.code);
    return formatSelectionError(copy.message, copy.solution);
  })();

  const toggleAccount = (id: string) => {
    const next = toggleChosenId(draft.adAccountIds, id, limits.adAccounts);
    if (next.overLimit) {
      const copy = metaAssetSelectionErrorCopy("over_limit");
      setAlert(formatSelectionError(copy.message, copy.solution));
      return;
    }
    setAlert(null);
    setDraft({
      ...draft,
      adAccountIds: next.ids,
      primaryAdAccountId:
        draft.primaryAdAccountId && next.ids.includes(draft.primaryAdAccountId)
          ? draft.primaryAdAccountId
          : null,
    });
  };

  const toggleIdentity = (pageId: string) => {
    const next = toggleChosenId(draft.identityPageIds, pageId, limits.identities);
    if (next.overLimit) {
      const copy = metaAssetSelectionErrorCopy("over_limit");
      setAlert(formatSelectionError(copy.message, copy.solution));
      return;
    }
    setAlert(null);
    setDraft({
      ...draft,
      identityPageIds: next.ids,
      primaryIdentityPageId:
        draft.primaryIdentityPageId &&
        next.ids.includes(draft.primaryIdentityPageId)
          ? draft.primaryIdentityPageId
          : null,
    });
  };

  const handleNext = async () => {
    if (currentStep !== "confirm") {
      setAlert(null);
      setStepIndex((index) => Math.min(index + 1, steps.length - 1));
      return;
    }

    try {
      await submit.mutateAsync(toSelectionSubmitBody(proposal));
      toast.success("Seleção definida");
      onDone();
    } catch (error) {
      if (error instanceof MetaAssetSelectionSetError) {
        setAlert(formatSelectionError(error.message, error.solution));
        return;
      }
      setAlert("Não foi possível definir a seleção");
    }
  };

  return (
    <>
      <div className="flex gap-1.5" role="progressbar" aria-valuenow={steps.indexOf(currentStep)}>
        {steps.map((step, index) => (
          <div
            key={step}
            title={STEP_LABEL[step]}
            className={cn(
              "h-1 flex-1 rounded-full",
              index <= steps.indexOf(currentStep) ? "bg-primary" : "bg-border",
            )}
          />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{hintCopy(currentStep, limits)}</p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <StepBody
          currentStep={currentStep}
          draft={draft}
          granted={granted}
          onPrimaryAccount={(id) => {
            setAlert(null);
            setDraft({ ...draft, primaryAdAccountId: id });
          }}
          onPrimaryIdentity={(pageId) => {
            setAlert(null);
            setDraft({ ...draft, primaryIdentityPageId: pageId });
          }}
          onToggleAccount={toggleAccount}
          onToggleIdentity={toggleIdentity}
        />
      </div>
      {alert ?? stepAlert ? (
        <p className="text-sm font-medium text-destructive" role="alert">
          {alert ?? stepAlert}
        </p>
      ) : null}
      <DialogFooter className="sm:justify-between">
        {stepIndex > 0 ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
            disabled={submit.isPending}
          >
            Voltar
          </Button>
        ) : (
          <span />
        )}
        <Button
          type="button"
          onClick={() => void handleNext()}
          disabled={!canAdvance || submit.isPending}
        >
          {submit.isPending
            ? "Definindo..."
            : currentStep === "confirm"
              ? "Definir seleção"
              : "Continuar"}
        </Button>
      </DialogFooter>
    </>
  );
}

function formatSelectionError(message: string, solution?: string): string {
  return solution ? `${message} ${solution}` : message;
}

function hintCopy(
  step: ReturnType<typeof visibleSelectionSteps>[number],
  limits: MetaAssetsResponse["limits"],
): string {
  if (step === "ad_accounts") {
    return `Marque até ${limits.adAccounts} conta${limits.adAccounts === 1 ? "" : "s"} de anúncios. Sem concedida, siga em frente.`;
  }
  if (step === "identities") {
    return `Marque até ${limits.identities} Identidade${limits.identities === 1 ? "" : "s"}. Sem concedida, siga em frente.`;
  }
  if (step === "primaries") {
    return "Indique o principal de cada tipo com mais de um marcado.";
  }
  return "A seleção fica fixa. Para alterar depois, peça nova seleção ou defina de novo.";
}

function StepBody({
  currentStep,
  draft,
  granted,
  onToggleAccount,
  onToggleIdentity,
  onPrimaryAccount,
  onPrimaryIdentity,
}: {
  currentStep: ReturnType<typeof visibleSelectionSteps>[number];
  draft: SelectionDraft;
  granted: Granted;
  onToggleAccount: (id: string) => void;
  onToggleIdentity: (pageId: string) => void;
  onPrimaryAccount: (id: string) => void;
  onPrimaryIdentity: (pageId: string) => void;
}) {
  if (currentStep === "ad_accounts") {
    if (granted.adAccounts.length === 0) {
      return <EmptyKind>Nenhuma conta concedida</EmptyKind>;
    }
    return (
      <ul className="space-y-2">
        {granted.adAccounts.map((account) => (
          <li key={account.id}>
            <ChoiceRow
              checked={draft.adAccountIds.includes(account.id)}
              title={account.name}
              meta={`${account.id}${account.statusLabel ? ` · ${account.statusLabel}` : ""}`}
              onToggle={() => onToggleAccount(account.id)}
            />
          </li>
        ))}
      </ul>
    );
  }

  if (currentStep === "identities") {
    if (granted.identities.length === 0) {
      return <EmptyKind>Nenhuma Identidade concedida</EmptyKind>;
    }
    return (
      <ul className="space-y-2">
        {granted.identities.map((identity) => (
          <li key={identity.pageId}>
            <ChoiceRow
              checked={draft.identityPageIds.includes(identity.pageId)}
              title={identity.pageName}
              imageSrc={identity.pagePictureUrl}
              meta={
                identity.instagramUsername
                  ? `@${identity.instagramUsername}`
                  : identity.pageId
              }
              onToggle={() => onToggleIdentity(identity.pageId)}
            />
          </li>
        ))}
      </ul>
    );
  }

  if (currentStep === "primaries") {
    const chosenAccounts = granted.adAccounts.filter((account) =>
      draft.adAccountIds.includes(account.id),
    );
    const chosenIdentities = granted.identities.filter((identity) =>
      draft.identityPageIds.includes(identity.pageId),
    );
    return (
      <div className="space-y-6">
        {chosenAccounts.length > 1 ? (
          <PrimaryGroup
            label="Conta de anúncios principal"
            options={chosenAccounts.map((account) => ({
              id: account.id,
              label: account.name,
            }))}
            value={draft.primaryAdAccountId}
            onChange={onPrimaryAccount}
          />
        ) : null}
        {chosenIdentities.length > 1 ? (
          <PrimaryGroup
            label="Identidade principal"
            options={chosenIdentities.map((identity) => ({
              id: identity.pageId,
              label: identity.pageName,
            }))}
            value={draft.primaryIdentityPageId}
            onChange={onPrimaryIdentity}
          />
        ) : null}
      </div>
    );
  }

  const filled = toSelectionSubmitBody(draftToProposal(draft));
  const primaryAccount = filled.adAccounts.find((item) => item.isPrimary)?.id;
  const primaryIdentity = filled.identities.find((item) => item.isPrimary)?.pageId;

  return (
    <div className="space-y-5">
      <SummaryList
        title="Contas de anúncios"
        empty="Nenhuma conta habilitada"
        items={granted.adAccounts
          .filter((account) => draft.adAccountIds.includes(account.id))
          .map((account) => ({
            id: account.id,
            label: account.name,
            isPrimary: account.id === primaryAccount,
          }))}
      />
      <SummaryList
        title="Identidades"
        empty="Nenhuma Identidade habilitada"
        items={granted.identities
          .filter((identity) => draft.identityPageIds.includes(identity.pageId))
          .map((identity) => ({
            id: identity.pageId,
            label: identity.pageName,
            isPrimary: identity.pageId === primaryIdentity,
          }))}
      />
    </div>
  );
}

function EmptyKind({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function ChoiceRow({
  checked,
  title,
  meta,
  imageSrc,
  onToggle,
}: {
  checked: boolean;
  title: string;
  meta: string;
  imageSrc?: string | null;
  onToggle: () => void;
}) {
  const initial = title.trim().charAt(0).toUpperCase() || "?";
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onToggle}
      className={cn(
        "flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left",
        checked ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      {imageSrc !== undefined ? (
        <Avatar className="mt-0.5 size-8 shrink-0">
          <AvatarImage src={imageSrc ?? undefined} alt="" />
          <AvatarFallback className="text-xs">{initial}</AvatarFallback>
        </Avatar>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {meta}
        </span>
      </span>
    </button>
  );
}

function PrimaryGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="space-y-2" role="radiogroup">
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.id)}
              className={cn(
                "flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left text-sm",
                selected ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function SummaryList({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<{ id: string; label: string; isPrimary: boolean }>;
  empty: string;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span>{item.label}</span>
              {item.isPrimary ? (
                <span className="text-xs font-medium text-primary">
                  principal
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
