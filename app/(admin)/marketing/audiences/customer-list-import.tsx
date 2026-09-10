"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CUSTOMER_FILE_MAX_BYTES, formatCustomerFileBytes } from "@/lib/customer-file/limits";
import type {
  CustomerFileImportPreview,
  CustomerFileImportStatus,
  CustomerFileUploadResult,
} from "@/lib/customer-file/import-service";
import type { CustomAudienceView } from "@/lib/meta-business/marketing/audiences/types";

type Operation = "create" | "add" | "remove" | "replace";

const OPERATION_LABELS: Record<Operation, string> = {
  create: "Criar lista com a primeira carga",
  add: "Adicionar contatos",
  remove: "Remover contatos",
  replace: "Substituir a lista inteira",
};

const COUNTRIES = ["BR", "PT", "US", "AR", "CL", "CO", "MX", "ES"];

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

function CustomerFileSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  disabled?: boolean;
}) {
  const emptyValue = "__customer_file_empty__";
  return (
    <Select
      value={value || emptyValue}
      onValueChange={(next) => onChange(next === emptyValue ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger className="mt-1 w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value || emptyValue} value={option.value || emptyValue}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The whole customer-list import journey: file, mapping, preview, declarations,
 * confirmation and follow-up. Every decision is revalidated by the server; this
 * screen only mirrors the same rules so a refusal is visible before the request.
 */
export function CustomerListImport({
  accountId,
  userId,
  audiences,
  onChanged,
}: {
  accountId: string;
  userId: string;
  audiences: CustomAudienceView[];
  onChanged: () => void;
}) {
  const apiBase = `/api/meta-marketing/${accountId}/audiences/customer-file`;
  const userQuery = `userId=${encodeURIComponent(userId)}`;
  const [operation, setOperation] = useState<Operation>("create");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [audienceId, setAudienceId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<CustomerFileUploadResult | null>(null);
  const [worksheet, setWorksheet] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [emailColumn, setEmailColumn] = useState("");
  const [phoneColumn, setPhoneColumn] = useState("");
  const [referenceCountry, setReferenceCountry] = useState("BR");
  const [preview, setPreview] = useState<CustomerFileImportPreview | null>(null);
  const [sendValidRowsOnly, setSendValidRowsOnly] = useState(false);
  const [dataOriginDeclared, setDataOriginDeclared] = useState(false);
  const [termsDeclared, setTermsDeclared] = useState(false);
  const [status, setStatus] = useState<CustomerFileImportStatus | null>(null);
  const [history, setHistory] = useState<CustomerFileImportStatus[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const targets = useMemo(
    () => audiences.filter((audience) => audience.capabilities.manageMembers === "available"),
    [audiences],
  );

  /** Any change that can alter what gets sent invalidates the confirmation. */
  const invalidate = useCallback(() => {
    setPreview(null);
    setSendValidRowsOnly(false);
  }, []);

  const loadHistory = useCallback(async () => {
    const response = await fetch(`${apiBase}?${userQuery}`);
    if (!response.ok) {
      if (response.status === 503) setEnabled(false);
      return;
    }
    setEnabled(true);
    const body = (await response.json()) as { operations: CustomerFileImportStatus[] };
    setHistory(body.operations);
  }, [apiBase, userQuery]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  // The operation keeps running with this screen closed; reopening reads the
  // confirmed progress back from the server instead of guessing it.
  useEffect(() => {
    if (!status || (status.phase !== "running" && status.phase !== "recovering")) return;
    const timer = setInterval(() => {
      void (async () => {
        const response = await fetch(
          `${apiBase}/${status.operationId}?${userQuery}`,
        );
        if (!response.ok) return;
        setStatus((await response.json()) as CustomerFileImportStatus);
        void loadHistory();
      })();
    }, 4000);
    return () => clearInterval(timer);
  }, [apiBase, userQuery, status, loadHistory]);

  const operate = async <T,>(run: () => Promise<T>, onDone: (result: T) => void, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await run());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const submitFile = () =>
    operate(
      async () => {
        if (!file) throw new Error("Escolha um arquivo CSV ou XLSX.");
        if (file.size > CUSTOMER_FILE_MAX_BYTES) {
          throw new Error(
            `O arquivo tem ${formatCustomerFileBytes(file.size)} e excede o limite de ${formatCustomerFileBytes(CUSTOMER_FILE_MAX_BYTES)}.`,
          );
        }
        const form = new FormData();
        form.set("file", file);
        form.set("operation", operation);
        if (operation === "create") {
          form.set("name", name);
          if (description) form.set("description", description);
        } else form.set("audienceId", audienceId);
        const response = await fetch(`${apiBase}?${userQuery}`, {
          method: "POST",
          body: form,
        });
        if (!response.ok) throw new Error(await readError(response, "Não foi possível receber o arquivo."));
        return (await response.json()) as CustomerFileUploadResult;
      },
      (result) => {
        setUpload(result);
        setHeaders(result.headers ?? []);
        setWorksheet(result.headers ? result.worksheets?.[0] ?? "" : "");
        setStatus(null);
        invalidate();
        void loadHistory();
      },
      "Não foi possível receber o arquivo.",
    );

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch(
      `${apiBase}/${upload!.operationId}?${userQuery}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    );
    if (!response.ok) throw new Error(await readError(response, "Não foi possível concluir a ação."));
    return response.json();
  };

  const chooseWorksheet = (chosen: string) =>
    operate(
      async () => post({ action: "inspect", worksheet: chosen }) as Promise<{ headers?: string[] }>,
      (result) => {
        setWorksheet(chosen);
        setHeaders(result.headers ?? []);
        invalidate();
      },
      "Não foi possível ler a planilha escolhida.",
    );

  const selection = () => ({
    emailColumn: emailColumn || undefined,
    phoneColumn: phoneColumn || undefined,
    referenceCountry,
    worksheet: worksheet || undefined,
  });

  const requestPreview = () =>
    operate(
      async () => post({ action: "preview", ...selection() }) as Promise<CustomerFileImportPreview>,
      (result) => setPreview(result),
      "Não foi possível gerar a prévia.",
    );

  const run = (action: "start" | "recover") =>
    operate(
      async () =>
        post({
          action,
          ...selection(),
          previewToken: preview!.previewToken,
          explicitlySendValidRows: sendValidRowsOnly,
          ...(operation !== "create" ? { audienceId } : {}),
          declarations: { dataOrigin: preview!.declarations.dataOrigin, termsAccepted: termsDeclared },
        }) as Promise<CustomerFileImportStatus>,
      (result) => {
        setStatus(result);
        onChanged();
        void loadHistory();
      },
      "Não foi possível iniciar a operação.",
    );

  const acceptTerms = () =>
    operate(
      async () => {
        const response = await fetch(
          `${apiBase}/terms?${userQuery}`,
          { method: "POST" },
        );
        if (!response.ok) throw new Error(await readError(response, "Não foi possível registrar o aceite dos termos."));
        return (await response.json()) as { accepted: boolean };
      },
      () => invalidate(),
      "Não foi possível registrar o aceite dos termos.",
    );

  const reportHref = preview
    ? `${apiBase}/${preview.operationId}/report?${new URLSearchParams({
        userId,
        ...(emailColumn ? { emailColumn } : {}),
        ...(phoneColumn ? { phoneColumn } : {}),
        referenceCountry,
        ...(worksheet ? { worksheet } : {}),
      })}`
    : null;

  const readyToSend =
    preview?.confirmation.allowed &&
    dataOriginDeclared &&
    termsDeclared &&
    (!preview.confirmation.requiresValidRowsChoice || sendValidRowsOnly);

  return (
    <details className="rounded-lg border bg-card p-4">
      <summary className="cursor-pointer font-medium">Lista de clientes por arquivo (CSV ou XLSX)</summary>

      {!enabled ? (
        <p className="mt-4 text-sm text-muted-foreground">
          A importação de listas de clientes está temporariamente indisponível. Campanhas, públicos existentes e histórico permanecem inalterados.
        </p>
      ) : null}

      {enabled ? <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label>
          Operação
          <CustomerFileSelect
            value={operation}
            onChange={(value) => {
              setOperation(value as Operation);
              setUpload(null);
              setHeaders([]);
              setStatus(null);
              invalidate();
            }}
            options={(Object.keys(OPERATION_LABELS) as Operation[]).map((value) => ({ value, label: OPERATION_LABELS[value] }))}
          />
        </label>

        {operation === "create" ? (
          <>
            <label>
              Nome da nova lista
              <Input value={name} onChange={(event) => { setName(event.target.value); setUpload(null); invalidate(); }} />
            </label>
            <label>
              Descrição (opcional)
              <Input value={description} onChange={(event) => { setDescription(event.target.value); setUpload(null); invalidate(); }} />
            </label>
          </>
        ) : (
          <label>
            Público de lista de clientes
            <CustomerFileSelect
              value={audienceId}
              onChange={(value) => { setAudienceId(value); setUpload(null); invalidate(); }}
              options={[{ value: "", label: "Selecione" }, ...targets.map((audience) => ({ value: audience.id, label: audience.name ?? audience.id }))]}
            />
          </label>
        )}

        <label>
          Arquivo (até {formatCustomerFileBytes(CUSTOMER_FILE_MAX_BYTES)})
          <Input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => { setFile(event.target.files?.[0] ?? null); setUpload(null); setHeaders([]); invalidate(); }}
          />
        </label>
      </div> : null}

      {enabled ? <p className="mt-3 text-xs text-muted-foreground">
        O arquivo é validado no servidor pelo conteúdo recebido, não pela extensão. O limite é de {formatCustomerFileBytes(CUSTOMER_FILE_MAX_BYTES)} e 100.000 registros de dados; nada é truncado.
      </p> : null}

      {enabled ? <Button className="mt-3" disabled={busy || !file} onClick={() => void submitFile()}>
        {busy ? "Enviando..." : "Enviar arquivo e preparar prévia"}
      </Button> : null}

      {enabled && upload ? (
        <div className="mt-4 space-y-3 rounded border p-3 text-sm">
          <p className="text-xs text-muted-foreground">{upload.retentionNotice}</p>

          {upload.worksheets && !headers.length ? (
            <label>
              Planilha a importar
              <CustomerFileSelect
                value={worksheet}
                onChange={(value) => void chooseWorksheet(value)}
                options={[{ value: "", label: "Selecione a planilha" }, ...upload.worksheets.map((sheet) => ({ value: sheet, label: sheet }))]}
              />
            </label>
          ) : null}

          {headers.length ? (
            <div className="grid gap-3 md:grid-cols-3">
              <label>
                Coluna de e-mail
                <CustomerFileSelect
                  value={emailColumn}
                  onChange={(value) => { setEmailColumn(value); invalidate(); }}
                  options={[{ value: "", label: "Não mapear" }, ...headers.map((header) => ({ value: header, label: header }))]}
                />
              </label>
              <label>
                Coluna de telefone
                <CustomerFileSelect
                  value={phoneColumn}
                  onChange={(value) => { setPhoneColumn(value); invalidate(); }}
                  options={[{ value: "", label: "Não mapear" }, ...headers.map((header) => ({ value: header, label: header }))]}
                />
              </label>
              {phoneColumn ? (
                <label>
                País de referência dos telefones sem DDI
                  <CustomerFileSelect
                    value={referenceCountry}
                    onChange={(value) => { setReferenceCountry(value); invalidate(); }}
                    options={COUNTRIES.map((country) => ({ value: country, label: country }))}
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          {headers.length ? (
            <Button variant="outline" disabled={busy || (!emailColumn && !phoneColumn)} onClick={() => void requestPreview()}>
              {busy ? "Analisando..." : "Gerar prévia"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {enabled && preview ? (
        <div className="mt-4 space-y-3 rounded border p-3 text-sm">
          <p>
            Conta {preview.adAccountId} · {preview.audience.isNew ? "novo público" : `público ${preview.audience.name ?? preview.audience.id}`} · {OPERATION_LABELS[preview.operation]}
            {preview.worksheet ? ` · planilha ${preview.worksheet}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Campos mapeados: {[preview.mapping.emailColumn && `e-mail (${preview.mapping.emailColumn})`, preview.mapping.phoneColumn && `telefone (${preview.mapping.phoneColumn})`].filter(Boolean).join(", ")}
            {preview.referenceCountry ? ` · país de referência ${preview.referenceCountry}` : ""}
          </p>

          <ul className="grid gap-1 md:grid-cols-5">
            <li>Lidos: {preview.counts.read}</li>
            <li>Válidos: {preview.counts.valid}</li>
            <li>Inválidos: {preview.counts.invalid}</li>
            <li>Avisos: {preview.counts.warnings}</li>
            <li>Duplicados removidos: {preview.counts.duplicatesRemoved}</li>
          </ul>

          {preview.invalidReasons.length ? (
            <ul className="text-xs text-muted-foreground">
              {preview.invalidReasons.map((reason) => <li key={reason.code}>{reason.message} ({reason.count})</li>)}
            </ul>
          ) : null}

          <table className="w-full text-xs">
            <caption className="text-left text-xs text-muted-foreground">Exemplos interpretados</caption>
            <thead><tr><th className="text-left">Linha</th><th className="text-left">E-mail</th><th className="text-left">Telefone</th><th className="text-left">Avisos</th></tr></thead>
            <tbody>
              {preview.samples.map((sample) => (
                <tr key={sample.line}>
                  <td>{sample.line}</td><td>{sample.email ?? "—"}</td><td>{sample.phone ?? "—"}</td><td>{sample.warnings.join(" ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {preview.report.available && reportHref ? (
            <p className="text-xs">
              <a className="underline" href={reportHref}>Baixar relatório de correção</a> — {preview.report.notice}
            </p>
          ) : null}

          {preview.confirmation.requiresCorrectedFile ? (
            <p role="alert" className="text-destructive">
              A substituição exige um arquivo corrigido: há linhas sem nenhum identificador válido e a lista não pode ser trocada por um subconjunto involuntário.
            </p>
          ) : null}
          {!preview.confirmation.allowed && !preview.confirmation.requiresCorrectedFile ? (
            <p role="alert" className="text-destructive">Nenhuma linha tem identificador válido; nada será enviado à Meta.</p>
          ) : null}

          {preview.confirmation.requiresValidRowsChoice ? (
            <label className="flex items-start gap-2">
              <Input type="checkbox" className="mt-1 h-4 w-4 p-0" checked={sendValidRowsOnly} onChange={(event) => setSendValidRowsOnly(event.target.checked)} />
              Enviar somente as {preview.counts.valid} linhas válidas, descartando {preview.counts.invalid} linha(s) sem identificador válido.
            </label>
          ) : null}

          <label className="flex items-start gap-2">
            <Input type="checkbox" className="mt-1 h-4 w-4 p-0" checked={dataOriginDeclared} onChange={(event) => setDataOriginDeclared(event.target.checked)} />
            Declaro que estes contatos foram fornecidos diretamente pelos titulares ao meu negócio ({preview.declarations.dataOrigin}).
          </label>
          <label className="flex items-start gap-2">
            <Input type="checkbox" className="mt-1 h-4 w-4 p-0" checked={termsDeclared} onChange={(event) => setTermsDeclared(event.target.checked)} disabled={!preview.declarations.termsAccepted} />
            Confirmo os termos de públicos de listas de clientes da Meta para esta conta.
          </label>
          {!preview.declarations.termsAccepted ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{preview.declarations.guidance}</p>
              <Button variant="outline" disabled={busy} onClick={() => void acceptTerms()}>Aceitar os termos da Meta agora</Button>
            </div>
          ) : null}

          <Button disabled={busy || !readyToSend} onClick={() => void run("start")}>
            {busy ? "Iniciando..." : "Confirmar e iniciar o envio"}
          </Button>
        </div>
      ) : null}

      {status ? (
        <div className="mt-4 space-y-2 rounded border p-3 text-sm" aria-live="polite">
          <p className="font-medium">{status.label}</p>
          <p className="text-xs text-muted-foreground">{status.detail}</p>
          <p className="text-xs text-muted-foreground">
            Lotes confirmados: {status.confirmedBatches} · registros recebidos e confirmados: {status.confirmedRecords} · rejeitados pela Meta: {status.rejectedRecords}
          </p>
          {status.audienceId ? <p className="font-mono text-xs text-muted-foreground">Público: {status.audienceId}</p> : null}
          {status.phase === "partial_or_unknown" || status.phase === "action_required" ? (
            <Button variant="outline" disabled={busy || !preview} onClick={() => void run("recover")}>Reconciliar e tentar novamente</Button>
          ) : null}
        </div>
      ) : null}

      {history.length ? (
        <div className="mt-4 rounded border p-3">
          <p className="text-sm font-medium">Histórico de importações desta conta</p>
          <p className="text-xs text-muted-foreground">Sem contatos: apenas metadados, contagens e resultado. Permanece disponível mesmo depois de excluir o público na Meta.</p>
          <ul className="mt-2 divide-y text-xs">
            {history.map((item) => (
              <li key={item.operationId} className="py-2">
                <span className="font-medium">{OPERATION_LABELS[item.operation as Operation] ?? item.operation}</span> · {item.label}
                {item.audienceId ? <span className="font-mono"> · {item.audienceId}</span> : null}
                <span className="text-muted-foreground"> · {new Date(item.receivedAt).toLocaleString("pt-BR")}</span>
                {item.pendingUnresolved ? <span className="text-destructive"> · pendência não resolvida</span> : null}
                <Button className="ml-2 h-6 px-2" variant="outline" onClick={() => setStatus(item)}>Acompanhar</Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
    </details>
  );
}
