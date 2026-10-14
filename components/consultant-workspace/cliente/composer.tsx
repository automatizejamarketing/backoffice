"use client";

import { useMemo, useRef, useState } from "react";
import { ClipboardCheck, Copy, ExternalLink, Phone, TriangleAlert } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getWhatsAppUrl } from "@/lib/phone";
import {
  MESSAGE_TEMPLATES,
  STAGE_LABEL,
  TEMPLATE_BY_KEY,
  type ClientJourney,
} from "@/lib/consultant-workspace/journey";
import { formatRelative } from "@/lib/consultant-workspace/metrics";
import type { WorkspaceClient } from "@/lib/consultant-workspace/types";
import { useWorkspaceState } from "@/components/consultant-workspace/shared/use-workspace-state";
import { useMySignature } from "@/components/consultant-workspace/common/workspace-context";
import {
  blockerPlan,
  formatPhone,
  placeholdersIn,
  primaryTemplateKey,
  renderMessage,
  suggestedTemplateKeys,
} from "@/components/consultant-workspace/jornada/lib";

export type ComposerTarget = {
  client: WorkspaceClient;
  journey: ClientJourney;
  templateKey?: string | null;
  nextStep?: string | null;
};

/**
 * Mensagem pronta para o cliente. Nada sai daqui sozinho: o gestor copia ou
 * abre o WhatsApp dele com o texto, manda, e registra o envio para ficar no
 * histórico do cliente.
 */
export function TemplateComposerDialog({
  target,
  onClose,
}: {
  target: ComposerTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={target != null} onOpenChange={(open) => (open ? null : onClose())}>
      {target ? (
        <ComposerBody
          key={`${target.client.userId}-${target.templateKey ?? ""}-${target.nextStep ?? ""}`}
          target={target}
          onClose={onClose}
        />
      ) : null}
    </Dialog>
  );
}

function ComposerBody({ target, onClose }: { target: ComposerTarget; onClose: () => void }) {
  const { client, journey } = target;
  const { store, apply, isSaving } = useWorkspaceState();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Quem manda é quem está escrevendo: "Aqui é o …" leva o seu nome.
  const consultantName = useMySignature();

  const suggested = useMemo(
    () => suggestedTemplateKeys(journey, client, target.templateKey),
    [journey, client, target.templateKey],
  );
  const reasons = useMemo(() => {
    const map = new Map<string, string>();
    for (const tag of journey.tags) {
      if (tag.templateKey && !map.has(tag.templateKey)) map.set(tag.templateKey, `tag “${tag.label}”`);
    }
    const plan = blockerPlan(journey, client);
    if (plan?.templateKey && journey.blocker && !map.has(plan.templateKey)) {
      map.set(plan.templateKey, `travado em “${journey.blocker.label}”`);
    }
    for (const key of suggested) {
      if (!map.has(key)) map.set(key, `etapa ${STAGE_LABEL[journey.stage].toLowerCase()}`);
    }
    return map;
  }, [journey, client, suggested]);
  const others = MESSAGE_TEMPLATES.filter((template) => !suggested.includes(template.key));

  const initialKey = target.templateKey ?? primaryTemplateKey(journey, client);
  const render = (key: string) => {
    const template = TEMPLATE_BY_KEY.get(key);
    if (!template) return "";
    return renderMessage(template, client, { consultantName, nextStep: target.nextStep });
  };
  const [templateKey, setTemplateKey] = useState(initialKey);
  const [text, setText] = useState(() => render(initialKey));

  const placeholders = placeholdersIn(text);
  const lastSent = store.sentMessages.find((message) => message.userId === client.userId);
  const recipient = client.name ?? client.displayName;

  function chooseTemplate(key: string) {
    setTemplateKey(key);
    setText(render(key));
  }

  function selectPlaceholder(placeholder: string) {
    const element = textareaRef.current;
    if (!element) return;
    const start = text.indexOf(placeholder);
    if (start < 0) return;
    element.focus();
    element.setSelectionRange(start, start + placeholder.length);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Mensagem copiada");
    } catch {
      toast.error("Não consegui copiar — selecione o texto e copie à mão");
    }
  }

  const whatsappUrl = getWhatsAppUrl(client.phone, text);

  /** Texto pronto para sair? (não vazio e sem [trechos] por completar) */
  function ready(action: string) {
    if (!text.trim()) {
      toast.error("A mensagem está vazia");
      return false;
    }
    if (placeholders.length > 0) {
      toast.error(`Complete ${placeholders.join(", ")} antes de ${action}`);
      selectPlaceholder(placeholders[0]);
      return false;
    }
    return true;
  }

  async function register() {
    if (!ready("registrar")) return;
    try {
      await apply({ op: "sendMessage", userId: client.userId, templateKey, text: text.trim() });
      toast.success("Envio registrado no histórico do cliente");
      onClose();
    } catch {
      // o erro já apareceu no aviso
    }
  }

  return (
    <DialogContent className="gap-3 sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Mensagem para {client.displayName}</DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>Para: {recipient}</span>
          {client.phone ? (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Phone className="size-3" /> {formatPhone(client.phone)}
            </span>
          ) : (
            <span className="text-amber-700 dark:text-amber-400">sem telefone cadastrado</span>
          )}
          {lastSent ? (
            <span className="text-muted-foreground">
              · último envio registrado {formatRelative(lastSent.at)} (
              {TEMPLATE_BY_KEY.get(lastSent.templateKey)?.label ?? "mensagem livre"})
            </span>
          ) : null}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="composer-template" className="text-xs text-muted-foreground">
          Modelo
        </Label>
        <Select value={templateKey} onValueChange={chooseTemplate}>
          <SelectTrigger id="composer-template" className="w-full text-sm data-[size=default]:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel className="text-[11px]">Sugeridas para este cliente</SelectLabel>
              {suggested.map((key) => (
                <SelectItem key={key} value={key} className="text-sm">
                  {TEMPLATE_BY_KEY.get(key)?.label}
                  <span className="ml-1 text-xs text-muted-foreground">· {reasons.get(key)}</span>
                </SelectItem>
              ))}
            </SelectGroup>
            {others.length > 0 ? (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel className="text-[11px]">Outras</SelectLabel>
                  {others.map((template) => (
                    <SelectItem key={template.key} value={template.key} className="text-sm">
                      {template.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            ) : null}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="composer-text" className="text-xs text-muted-foreground">
          Texto (pode editar)
        </Label>
        <Textarea
          id="composer-text"
          ref={textareaRef}
          rows={7}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="text-sm leading-relaxed"
        />
        {placeholders.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-amber-300/70 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200">
            <TriangleAlert className="size-3.5 shrink-0" />
            <span>Falta completar:</span>
            {placeholders.map((placeholder) => (
              <button
                key={placeholder}
                type="button"
                onClick={() => selectPlaceholder(placeholder)}
                className="rounded bg-amber-200/70 px-1.5 py-0.5 font-mono text-[11px] hover:bg-amber-300/70 dark:bg-amber-900/60 dark:hover:bg-amber-800/60"
                title="Selecionar no texto para substituir"
              >
                {placeholder}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">{text.length} caracteres · pronto para mandar</p>
        )}
      </div>

      <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] text-muted-foreground sm:max-w-xs">
          A mensagem sai do seu WhatsApp. Registre o envio para ficar no histórico do cliente.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={copy}>
            <Copy className="size-3.5" /> Copiar
          </Button>
          {whatsappUrl ? (
            <Button variant="outline" size="sm" asChild>
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  if (!ready("abrir no WhatsApp")) event.preventDefault();
                }}
              >
                <ExternalLink className="size-3.5" /> Abrir no WhatsApp
              </a>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled title="O cliente não tem telefone válido cadastrado">
              <ExternalLink className="size-3.5" /> Abrir no WhatsApp
              <span className="text-[10px] font-normal">· sem telefone válido</span>
            </Button>
          )}
          <Button size="sm" onClick={register} disabled={isSaving}>
            <ClipboardCheck className="size-3.5" /> Registrar envio
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
