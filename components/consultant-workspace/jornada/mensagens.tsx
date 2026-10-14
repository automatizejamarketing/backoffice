"use client";

import { Fragment, useMemo } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { MESSAGE_TEMPLATES, STAGE_LABEL, TEMPLATE_BY_KEY } from "@/lib/consultant-workspace/journey";
import { formatRelative } from "@/lib/consultant-workspace/metrics";
import type { WorkspaceState } from "@/lib/consultant-workspace/types";
import { StageDot } from "@/components/consultant-workspace/common/journey-bits";
import { useRememberView } from "@/components/consultant-workspace/common/last-view";
import { clientHref } from "@/components/consultant-workspace/common/routes";
import { usePrimedWorkspaceState } from "@/components/consultant-workspace/common/use-primed-state";
import { VARIABLE_LABEL, plural } from "./lib";

function TemplateBody({ body }: { body: string }) {
  const parts = body.split(/(\{\{\w+\}\})/g);
  return (
    <p className="text-[13px] leading-relaxed">
      {parts.map((part, index) => {
        const match = part.match(/^\{\{(\w+)\}\}$/);
        if (!match) return <Fragment key={index}>{part}</Fragment>;
        return (
          <span
            key={index}
            className="mx-px inline-block rounded bg-sky-100 px-1 text-[12px] font-medium text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
            title={`Preenchido automaticamente: {{${match[1]}}}`}
          >
            {VARIABLE_LABEL[match[1]] ?? match[1]}
          </span>
        );
      })}
    </p>
  );
}

export function MensagensView({
  initialStore,
  names,
  now,
}: {
  initialStore: WorkspaceState;
  /** Clientes que você pode ver: só as mensagens deles aparecem. */
  names: Record<string, string>;
  now: number;
}) {
  const { store } = usePrimedWorkspaceState(initialStore, now);
  useRememberView("mensagens");
  const sent = useMemo(
    () =>
      (store.sentMessages ?? [])
        .filter((message) => message.userId in names)
        .sort((a, b) => (a.at < b.at ? 1 : -1)),
    [store.sentMessages, names],
  );
  const sentCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const message of sent) map.set(message.templateKey, (map.get(message.templateKey) ?? 0) + 1);
    return map;
  }, [sent]);

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 px-4 py-5 lg:px-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Mensagens</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Os modelos que o botão “Mensagem” usa e os envios registrados. Os{" "}
          <span className="rounded bg-sky-100 px-1 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">destaques</span> são preenchidos com os dados de
          cada cliente. A mensagem sai do seu WhatsApp; aqui fica o registro.
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section className="min-w-0 space-y-2.5">
          <h2 className="text-base font-semibold">
            Modelos <span className="text-sm font-normal text-muted-foreground">({MESSAGE_TEMPLATES.length})</span>
          </h2>
          <ul className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {MESSAGE_TEMPLATES.map((template) => (
              <li key={template.key} className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-sm font-semibold">{template.label}</p>
                  <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                    {sentCount.get(template.key)
                      ? `${plural(sentCount.get(template.key) ?? 0, "envio", "envios")}`
                      : "nunca usado"}
                  </span>
                </div>
                <TemplateBody body={template.body} />
                <div className="mt-auto flex flex-wrap gap-1.5">
                  {template.stages.map((stage) => (
                    <span
                      key={stage}
                      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
                    >
                      <StageDot stage={stage} /> {STAGE_LABEL[stage]}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="min-w-0 space-y-2.5 xl:sticky xl:top-4 xl:self-start">
          <h2 className="text-base font-semibold">
            Envios registrados <span className="text-sm font-normal text-muted-foreground">({sent.length})</span>
          </h2>
          {sent.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-10 text-center">
              <Send className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Nenhum envio registrado ainda</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Use o botão “Mensagem” em qualquer cartão da Jornada ou na página do cliente e, depois de mandar,
                clique em “Registrar envio”.
              </p>
            </div>
          ) : (
            <ol className="space-y-2">
              {sent.map((message) => (
                <li key={message.id} className="rounded-xl border bg-card px-3 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <Link
                      href={clientHref(message.userId)}
                      className="min-w-0 truncate text-sm font-medium hover:underline"
                    >
                      {names[message.userId] ?? "Cliente"}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      · {TEMPLATE_BY_KEY.get(message.templateKey)?.label ?? "Mensagem livre"}
                    </span>
                    <span className="ml-auto text-[11px] text-muted-foreground">{formatRelative(message.at)}</span>
                  </div>
                  <p className="mt-1.5 rounded-lg rounded-tl-none bg-emerald-50 px-3 py-2 text-[13px] leading-relaxed whitespace-pre-line text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-50">
                    {message.text}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    registrado por {message.by}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
