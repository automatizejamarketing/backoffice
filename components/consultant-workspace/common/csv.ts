/** Baixa um CSV (separador ";", vírgula decimal) que abre direto no Excel em pt-BR. */
export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number | null>>) {
  const escape = (value: string | number | null) => {
    if (value == null) return "";
    const text = typeof value === "number" ? String(Math.round(value * 100) / 100).replace(".", ",") : value;
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = [header, ...rows].map((row) => row.map(escape).join(";")).join("\n");
  const blob = new Blob([`﻿${body}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
