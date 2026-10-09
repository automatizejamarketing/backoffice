"use client";

import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AiProviderMark } from "@/components/ai-provider-logo";
import { Button } from "@/components/ui/button";
import {
  CLAUDE_CODE_SERVER_NAME,
  CONNECTOR_NAME,
  TEST_PROMPT,
  claudeCodeCommand,
  claudeConnectorLink,
  type AiProvider,
} from "@/lib/mcp/connections";
import { cn } from "@/lib/utils";

type Step = {
  title: string;
  description: string;
  note?: string;
  link?: { label: string; href: string };
  /** Name + address of the connector, to paste in the form. */
  server?: boolean;
  command?: boolean;
  prompt?: boolean;
};

type GuideKey = "claude" | "chatgpt" | "claude-code";

type Guide = { key: GuideKey; name: string; provider: AiProvider; terminal?: boolean; steps: Step[] };

function authorizeStep(app: string): Step {
  return {
    title: "Autorize com a sua conta do backoffice",
    description: `Na janela que o ${app} abrir, entre com o seu e-mail da equipe, confira o que a IA poderá fazer e clique em Autorizar conexão.`,
    note: `Espere voltar ao ${app} antes de avançar.`,
  };
}

function readyStep(app: string, href: string): Step {
  return {
    title: "Tudo pronto",
    description: `Abra uma conversa nova no ${app}, deixe o conector ${CONNECTOR_NAME} ligado nas ferramentas e envie:`,
    prompt: true,
    link: { label: `Abrir conversa no ${app}`, href },
    note: "Se a sua carteira aparecer na resposta, está funcionando. A conexão aparece em Suas conexões, aqui embaixo.",
  };
}

function guides(serverUrl: string): Guide[] {
  return [
    {
      key: "claude",
      name: "Claude",
      provider: "claude",
      steps: [
        {
          title: "Adicione o conector",
          description: `O link abre o formulário de conector do Claude já com nome e endereço. Confira e clique em Add.`,
          link: { label: "Abrir formulário no Claude", href: claudeConnectorLink(serverUrl) },
          server: true,
          note: "Se o formulário não abrir, vá em Configurações → Conectores → Adicionar conector personalizado e cole os dois campos. No plano Team ou Enterprise, quem administra a organização adiciona o conector uma vez e cada pessoa só clica em Connect.",
        },
        {
          ...authorizeStep("Claude"),
          description: `Clique em Connect no conector ${CONNECTOR_NAME}. ${authorizeStep("Claude").description}`,
        },
        readyStep("Claude", "https://claude.ai/new"),
      ],
    },
    {
      key: "chatgpt",
      name: "ChatGPT",
      provider: "chatgpt",
      steps: [
        {
          title: "Ative o modo desenvolvedor",
          description: "No ChatGPT, abra o menu da sua conta → Configurações → Segurança e login → Modo desenvolvedor e ative a opção.",
          link: { label: "Abrir ChatGPT", href: "https://chatgpt.com/" },
        },
        {
          title: "Crie a conexão",
          description: "Abra Plugins, clique em + para criar um plugin, preencha os campos abaixo, escolha OAuth como autenticação e clique em Criar.",
          link: { label: "Abrir plugins do ChatGPT", href: "https://chatgpt.com/plugins" },
          server: true,
          note: "Se o botão de criar não aparecer, confira se o modo desenvolvedor está ativo.",
        },
        authorizeStep("ChatGPT"),
        readyStep("ChatGPT", "https://chatgpt.com/"),
      ],
    },
    {
      key: "claude-code",
      name: "Claude Code",
      provider: "claude",
      terminal: true,
      steps: [
        {
          title: "Adicione o servidor",
          description: "No terminal, rode:",
          command: true,
        },
        {
          title: "Autorize",
          description: `No Claude Code, digite /mcp, escolha ${CLAUDE_CODE_SERVER_NAME} e depois Authenticate. O navegador abre o backoffice: entre com o seu e-mail da equipe e clique em Autorizar conexão.`,
        },
        {
          title: "Tudo pronto",
          description: "Peça ao Claude Code:",
          prompt: true,
          note: "Se a sua carteira aparecer na resposta, está funcionando.",
        },
      ],
    },
  ];
}

export function CopyField({ label, value, wrap = false }: { label: string; value: string; wrap?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie.");
    }
  }
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex min-w-0 items-center gap-1 rounded-md border bg-muted/40 py-1 pr-1 pl-3">
        {wrap ? (
          <p className="min-w-0 flex-1 py-1 text-sm text-foreground">{value}</p>
        ) : (
          <code className="min-w-0 flex-1 truncate font-mono text-sm" title={value}>
            {value}
          </code>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={copy}
          aria-label={`Copiar ${label.toLowerCase()}`}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        <span className="sr-only" aria-live="polite">
          {copied ? `${label} copiado` : ""}
        </span>
      </div>
    </div>
  );
}

export function ConnectGuide({ serverUrl, onDone }: { serverUrl: string; onDone: () => void }) {
  const all = guides(serverUrl);
  const [key, setKey] = useState<GuideKey>("claude");
  const [stepIndex, setStepIndex] = useState(0);
  const guide = all.find((g) => g.key === key) ?? all[0];
  const step = guide.steps[stepIndex];
  const isLast = stepIndex === guide.steps.length - 1;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p id="guide-app-label" className="text-sm font-medium">
          Onde você vai usar?
        </p>
        <div role="group" aria-labelledby="guide-app-label" className="grid grid-cols-3 gap-2">
          {all.map((g) => (
            <button
              key={g.key}
              type="button"
              aria-pressed={g.key === key}
              onClick={() => {
                setKey(g.key);
                setStepIndex(0);
              }}
              className={cn(
                "flex min-w-0 flex-col items-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors sm:flex-row sm:gap-2.5",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                g.key === key ? "border-foreground/60 bg-muted/60" : "hover:bg-muted/40",
              )}
            >
              <AiProviderMark provider={g.provider} terminal={g.terminal} />
              <span className="truncate">{g.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p role="status" className="text-xs font-medium text-muted-foreground tabular-nums">
          Passo {stepIndex + 1} de {guide.steps.length}
        </p>
        <div className="flex gap-1.5" aria-hidden="true">
          {guide.steps.map((s, i) => (
            <span key={s.title} className={cn("h-1 flex-1 rounded-full", i <= stepIndex ? "bg-foreground" : "bg-muted")} />
          ))}
        </div>
      </div>

      <div key={`${key}-${stepIndex}`} className="min-h-56 space-y-4">
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold">{step.title}</h3>
          <p className="text-sm leading-6 text-muted-foreground">{step.description}</p>
        </div>
        {step.server ? (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <CopyField label="Nome" value={CONNECTOR_NAME} />
            <CopyField label="Endereço" value={serverUrl} />
          </div>
        ) : null}
        {step.command ? <CopyField label="Comando" value={claudeCodeCommand(serverUrl)} /> : null}
        {step.prompt ? <CopyField label="Mensagem" value={TEST_PROMPT} wrap /> : null}
        {step.link ? (
          <Button asChild variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal">
            <a href={step.link.href} target="_blank" rel="noopener noreferrer">
              {step.link.label}
              <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
            </a>
          </Button>
        ) : null}
        {step.note ? <p className="text-xs leading-5 text-muted-foreground">{step.note}</p> : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t pt-4">
        {/* aria-disabled instead of disabled, and one forward button, so keyboard focus survives the step change. */}
        <Button
          variant="ghost"
          aria-disabled={stepIndex === 0}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Voltar
        </Button>
        <Button onClick={() => (isLast ? onDone() : setStepIndex((i) => Math.min(guide.steps.length - 1, i + 1)))}>
          {isLast ? "Ver minhas conexões" : "Próximo passo"}
          {isLast ? null : <ArrowRight className="size-4" aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}
