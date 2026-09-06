/**
 * O copia-e-cola de um link Pix mora em duas colunas diferentes conforme quem
 * criou o link.
 *
 * O backoffice sempre gravou o EMV em `init_point` — a coluna nasceu para a URL
 * de preferência do Checkout Pro e foi reaproveitada. O app grava em
 * `pix_copy_paste` e deixa `init_point` nulo. Como a tabela é a mesma, a tela do
 * backoffice precisa ler as duas: até 06/09/2026 ela só olhava `init_point` e,
 * para todo link vindo do app, mostrava a linha sem código nenhum para copiar.
 */
export function normalizePixInitPoint(
  value: string | null | undefined,
  pixCopyPaste?: string | null,
): { initPoint: string; pixCopyPasteCode: string | undefined } {
  const initPoint = value ?? "";
  const fromColumn = pixCopyPaste?.trim();

  return {
    initPoint,
    pixCopyPasteCode:
      fromColumn && fromColumn.length > 0
        ? fromColumn
        : initPoint.startsWith("000201")
          ? initPoint
          : undefined,
  };
}
