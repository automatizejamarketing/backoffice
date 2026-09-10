import {
  type CountryCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js";
import { unzipSync } from "fflate";

/** The same binary limit is enforced before the browser starts an upload. */
export const CUSTOMER_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const CUSTOMER_FILE_MAX_ROWS = 100_000;
export const CUSTOMER_FILE_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Bounds expanded XLSX XML before decompression. */
export const CUSTOMER_FILE_XLSX_MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
export const CUSTOMER_FILE_XLSX_MAX_ENTRIES = 256;

export type CustomerFileOperation = "create" | "add" | "remove" | "replace";

export type CustomerFileContext = {
  customerId: string;
  adAccountId: string;
  audienceId?: string;
  operation: CustomerFileOperation;
};

export type CustomerFileMapping = {
  emailColumn?: string;
  phoneColumn?: string;
};

export type CustomerFileWarning = {
  field: "email" | "phone";
  code: "INVALID_EMAIL" | "INVALID_PHONE";
  message: string;
};

export type CustomerFileRow = {
  line: number;
  /** Raw values are temporary material and must never enter operational history. */
  values: Record<string, string>;
  identifiers: { email?: string; phone?: string };
  warnings: CustomerFileWarning[];
  valid: boolean;
};

export type CustomerFilePreview = {
  format: "csv" | "xlsx";
  worksheet?: string;
  headers?: string[];
  context: CustomerFileContext;
  mapping: CustomerFileMapping;
  referenceCountry: CountryCode;
  receivedAt: Date;
  expiresAt: Date;
  rows: CustomerFileRow[];
  counts: {
    read: number;
    valid: number;
    invalid: number;
    warnings: number;
    duplicatesRemoved: number;
  };
};

export type CustomerFileXlsxSelection = {
  format: "xlsx";
  selectionRequired: true;
  worksheets: string[];
};

type CsvRow = string[];

/** The received bytes, rather than a filename, determine the format. */
export function detectCustomerFileFormat(bytes: Uint8Array): "csv" | "xlsx" {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04 ? "xlsx" : "csv";
}

function decodeCustomerFileCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new Error("CSV invÃ¡lido: use UTF-8.");
  }
}

function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else value += char;
      continue;
    }
    if (char === '"') {
      if (value) throw new Error("CSV inválido: aspas devem iniciar um campo.");
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += char;
  }
  if (quoted) throw new Error("CSV inválido: aspas não foram fechadas.");
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function nonEmpty(row: CsvRow): boolean {
  return row.some((value) => value.trim().length > 0);
}

function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizePhone(value: string, referenceCountry: CountryCode): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const phone = parsePhoneNumberFromString(trimmed, referenceCountry);
  return phone?.isValid() ? phone.number : null;
}

function assertMapping(headers: string[], mapping: CustomerFileMapping): void {
  if (mapping.emailColumn === "__inspect__" && !mapping.phoneColumn) return;
  if (!mapping.emailColumn && !mapping.phoneColumn) throw new Error("Mapeie uma coluna de e-mail ou telefone.");
  if (mapping.emailColumn && !headers.includes(mapping.emailColumn)) throw new Error("A coluna de e-mail mapeada não existe no CSV.");
  if (mapping.phoneColumn && !headers.includes(mapping.phoneColumn)) throw new Error("A coluna de telefone mapeada não existe no CSV.");
}

export function prepareCustomerFileCsv(input: {
  bytes: Uint8Array;
  mapping: CustomerFileMapping;
  context: CustomerFileContext;
  referenceCountry?: CountryCode;
  now?: Date;
}): CustomerFilePreview {
  if (input.bytes.byteLength > CUSTOMER_FILE_MAX_BYTES) throw new Error("O arquivo excede o limite de 20 MB.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new Error("CSV inválido: use UTF-8.");
  }
  const parsed = parseCsv(text);
  const header = parsed.shift()?.map((value) => value.trim());
  if (!header?.length || !nonEmpty(header) || new Set(header).size !== header.length) throw new Error("CSV inválido: informe um cabeçalho único.");
  assertMapping(header, input.mapping);
  const data = parsed.filter(nonEmpty);
  if (data.length > CUSTOMER_FILE_MAX_ROWS) throw new Error("O arquivo excede o limite de 100.000 registros.");

  const referenceCountry = input.referenceCountry ?? "BR";
  const emailIndex = input.mapping.emailColumn ? header.indexOf(input.mapping.emailColumn) : -1;
  const phoneIndex = input.mapping.phoneColumn ? header.indexOf(input.mapping.phoneColumn) : -1;
  const rows = data.map((row, index) => {
    const values = Object.fromEntries(header.map((name, column) => [name, row[column] ?? ""]));
    const warnings: CustomerFileWarning[] = [];
    const emailValue = emailIndex < 0 ? "" : row[emailIndex] ?? "";
    const phoneValue = phoneIndex < 0 ? "" : row[phoneIndex] ?? "";
    const email = emailValue.trim() ? normalizeEmail(emailValue) : null;
    const phone = phoneValue.trim() ? normalizePhone(phoneValue, referenceCountry) : null;
    if (emailValue.trim() && !email) warnings.push({ field: "email", code: "INVALID_EMAIL", message: "E-mail inválido; o outro identificador válido ainda será aproveitado." });
    if (phoneValue.trim() && !phone) warnings.push({ field: "phone", code: "INVALID_PHONE", message: "Telefone inválido ou sem DDD; informe DDI explícito quando não for nacional." });
    const identifiers = { ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
    return { line: index + 2, values, identifiers, warnings, valid: Boolean(email || phone) };
  });
  const receivedAt = input.now ?? new Date();
  return {
    format: "csv", headers: header, context: input.context, mapping: input.mapping, referenceCountry, receivedAt,
    expiresAt: new Date(receivedAt.getTime() + CUSTOMER_FILE_RETENTION_MS), rows,
    counts: {
      read: rows.length,
      valid: rows.filter((row) => row.valid).length,
      invalid: rows.filter((row) => !row.valid).length,
      warnings: rows.reduce((total, row) => total + row.warnings.length, 0),
      duplicatesRemoved: 0,
    },
  };
}

type ZipEntry = { name: string; uncompressedSize: number };

function readXlsxZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new Error("XLSX inválido: contêiner ZIP não reconhecido.");
  const entriesCount = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (entriesCount === 0xffff || centralSize === 0xffff_ffff || offset === 0xffff_ffff) throw new Error("XLSX inválido: ZIP64 não é suportado.");
  if (entriesCount > CUSTOMER_FILE_XLSX_MAX_ENTRIES || offset + centralSize > end) throw new Error("XLSX inválido: estrutura ZIP excede os limites.");
  const entries: ZipEntry[] = [];
  let expanded = 0;
  for (let index = 0; index < entriesCount; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error("XLSX inválido: diretório ZIP corrompido.");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    const localOffset = view.getUint32(offset + 42, true);
    if (next > end || flags & 9 || ![0, 8].includes(method) || localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("XLSX inválido: entrada ZIP não suportada.");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    if (view.getUint32(localOffset + 18, true) !== compressedSize || view.getUint32(localOffset + 22, true) !== uncompressedSize || localOffset + 30 + localNameLength + localExtraLength + compressedSize > bytes.length) throw new Error("XLSX inválido: tamanho ZIP inconsistente.");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name.startsWith("/") || name.split("/").includes("..")) throw new Error("XLSX inválido: caminho ZIP inseguro.");
    expanded += uncompressedSize;
    if (expanded > CUSTOMER_FILE_XLSX_MAX_EXPANDED_BYTES) throw new Error("O XLSX excede o limite de expansão de 100 MB.");
    entries.push({ name, uncompressedSize });
    offset = next;
  }
  return entries;
}

function xmlAttribute(attributes: string, name: string): string | undefined {
  return new RegExp(`\\b${name}=["']([^"']*)["']`).exec(attributes)?.[1];
}

function xmlText(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function columnIndex(reference: string): number {
  return reference.replace(/\d/g, "").split("").reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function xlsxRows(xml: string, sharedStrings: string[]): string[][] {
  if (/<f(?:\s[^>]*)?>/i.test(xml)) throw new Error("XLSX com fórmula não pode ser importado: copie os valores antes da prévia.");
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const values: string[] = [];
    for (const cell of row[1]!.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = xmlAttribute(cell[1]!, "r");
      if (!reference) throw new Error("XLSX inválido: célula sem referência.");
      const type = xmlAttribute(cell[1]!, "t");
      const body = cell[2]!;
      const value = type === "inlineStr" ? xmlText(body) : xmlText(/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      values[columnIndex(reference)] = type === "s" ? sharedStrings[Number(value)] ?? "" : value;
    }
    return values.map((value) => value ?? "");
  });
}

function csvBytes(rows: string[][]): Uint8Array {
  return new TextEncoder().encode(rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n"));
}

export function prepareCustomerFileXlsx(input: {
  bytes: Uint8Array;
  worksheet?: string;
  mapping: CustomerFileMapping;
  context: CustomerFileContext;
  referenceCountry?: CountryCode;
  now?: Date;
}): CustomerFilePreview | CustomerFileXlsxSelection {
  if (input.bytes.byteLength > CUSTOMER_FILE_MAX_BYTES) throw new Error("O arquivo excede o limite de 20 MB.");
  readXlsxZipEntries(input.bytes);
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(input.bytes); } catch { throw new Error("XLSX inválido: não foi possível descompactar com segurança."); }
  const workbook = files["xl/workbook.xml"];
  const relationships = files["xl/_rels/workbook.xml.rels"];
  if (!workbook || !relationships) throw new Error("XLSX inválido: estrutura de planilhas ausente.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const targets = new Map([...decoder.decode(relationships).matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)].map((relationship) => [xmlAttribute(relationship[1]!, "Id"), { target: xmlAttribute(relationship[1]!, "Target"), type: xmlAttribute(relationship[1]!, "Type") }]));
  const sheets = [...decoder.decode(workbook).matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/g)].map((sheet) => {
    const name = xmlAttribute(sheet[1]!, "name");
    const relationship = targets.get(xmlAttribute(sheet[1]!, "r:id"));
    const target = relationship?.target;
    if (!name || !target || !relationship.type?.endsWith("/worksheet") || !target.startsWith("worksheets/") || target.split("/").includes("..")) throw new Error("XLSX inválido: planilha sem relação válida.");
    return { name, path: `xl/${target}` };
  });
  if (!sheets.length || new Set(sheets.map((sheet) => sheet.name)).size !== sheets.length) throw new Error("XLSX inválido: informe planilhas com nomes únicos.");
  if (!input.worksheet && sheets.length > 1) return { format: "xlsx", selectionRequired: true, worksheets: sheets.map((sheet) => sheet.name) };
  const selected = sheets.find((sheet) => sheet.name === (input.worksheet ?? sheets[0]!.name));
  if (!selected || !files[selected.path]) throw new Error("A planilha selecionada não existe no XLSX.");
  const shared = files["xl/sharedStrings.xml"];
  const sharedStrings = shared ? [...decoder.decode(shared).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((string) => xmlText(string[1]!)) : [];
  const preview = prepareCustomerFileCsv({ bytes: csvBytes(xlsxRows(decoder.decode(files[selected.path]), sharedStrings)), mapping: input.mapping, context: input.context, referenceCountry: input.referenceCountry, now: input.now });
  return { ...preview, format: "xlsx", worksheet: selected.name };
}

export function inspectCustomerFile(input: {
  bytes: Uint8Array;
  worksheet?: string;
}): CustomerFileXlsxSelection | { format: "csv" | "xlsx"; worksheet?: string; headers: string[] } {
  if (detectCustomerFileFormat(input.bytes) === "csv") {
    const rows = parseCsv(decodeCustomerFileCsv(input.bytes));
    const headers = rows.shift()?.map((value) => value.trim()) ?? [];
    if (!headers.length || !nonEmpty(headers) || new Set(headers).size !== headers.length) {
      throw new Error("CSV invÃ¡lido: informe um cabeÃ§alho Ãºnico.");
    }
    return { format: "csv", headers };
  }
  if (!input.worksheet) {
    const selection = prepareCustomerFileXlsx({ bytes: input.bytes, mapping: { emailColumn: "__inspect__" }, context: { customerId: "inspect", adAccountId: "inspect", operation: "add" } });
    if ("selectionRequired" in selection) return selection;
    return { format: "xlsx", worksheet: selection.worksheet, headers: selection.headers ?? [] };
  }
  const selection = prepareCustomerFileXlsx({ bytes: input.bytes, worksheet: input.worksheet, mapping: { emailColumn: "__inspect__" }, context: { customerId: "inspect", adAccountId: "inspect", operation: "add" } });
  if ("selectionRequired" in selection) throw new Error("A planilha selecionada nÃ£o existe no XLSX.");
  return { format: "xlsx", worksheet: selection.worksheet, headers: selection.headers ?? [] };
}

export function prepareCustomerFile(input: {
  bytes: Uint8Array;
  worksheet?: string;
  mapping: CustomerFileMapping;
  context: CustomerFileContext;
  referenceCountry?: CountryCode;
  now?: Date;
}): CustomerFilePreview | CustomerFileXlsxSelection {
  return detectCustomerFileFormat(input.bytes) === "xlsx" ? prepareCustomerFileXlsx(input) : prepareCustomerFileCsv(input);
}

export function reviewCustomerFileConfirmation(preview: CustomerFilePreview, explicitlySendValidRows: boolean): { allowed: true } | { allowed: false; reason: "NO_VALID_ROWS" | "EXPLICIT_VALID_ROWS_CONSENT_REQUIRED" | "REPLACEMENT_REQUIRES_CORRECTED_FILE" } {
  if (preview.counts.valid === 0) return { allowed: false, reason: "NO_VALID_ROWS" };
  if (preview.counts.invalid > 0 && preview.context.operation === "replace") return { allowed: false, reason: "REPLACEMENT_REQUIRES_CORRECTED_FILE" };
  if (preview.counts.invalid > 0 && !explicitlySendValidRows) return { allowed: false, reason: "EXPLICIT_VALID_ROWS_CONSENT_REQUIRED" };
  return { allowed: true };
}

/** A confirmation is intentionally bound to every input that can change a send. */
export function isCustomerFilePreviewCurrent(
  preview: CustomerFilePreview,
  current: Pick<CustomerFilePreview, "context" | "mapping" | "referenceCountry" | "format" | "worksheet">,
): boolean {
  return preview.format === current.format &&
    preview.worksheet === current.worksheet &&
    preview.referenceCountry === current.referenceCountry &&
    preview.context.customerId === current.context.customerId &&
    preview.context.adAccountId === current.context.adAccountId &&
    preview.context.audienceId === current.context.audienceId &&
    preview.context.operation === current.context.operation &&
    preview.mapping.emailColumn === current.mapping.emailColumn &&
    preview.mapping.phoneColumn === current.mapping.phoneColumn;
}

function reportCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** A correction report is temporary PII: callers must authorize it before access. */
export function customerFileCorrectionReport(preview: CustomerFilePreview, now = new Date()): string {
  if (now > preview.expiresAt) throw new Error("A prévia expirou; envie um novo arquivo para gerar o relatório.");
  const headers = Object.keys(preview.rows[0]?.values ?? {});
  return [
    [...headers, "motivos"].map(reportCell).join(","),
    ...preview.rows.filter((row) => !row.valid || row.warnings.length > 0).map((row) => [
      ...headers.map((header) => row.values[header] ?? ""),
      row.warnings.map((warning) => warning.message).join(" ") || "Linha sem identificador válido.",
    ].map(reportCell).join(",")),
  ].join("\r\n");
}
