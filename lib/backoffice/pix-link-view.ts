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

export type PixLinkState = "awaiting" | "expired_unpaid" | "paid" | "canceled";

/**
 * What a Pix charge means for the operator right now. `pending` in the table
 * is not enough: the expiry cron only runs at noon, so a link whose
 * `expires_at` already passed is unpaid and dead even while the row still
 * says `pending`.
 */
export function getPixLinkState(
  link: { status: string; expiresAt: Date | string },
  now: Date = new Date(),
): PixLinkState {
  if (link.status === "approved") return "paid";
  if (link.status === "canceled") return "canceled";
  if (link.status === "expired") return "expired_unpaid";
  const expiresAt = new Date(link.expiresAt);
  if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) {
    return "expired_unpaid";
  }
  return "awaiting";
}

export const PIX_LINK_STATE_LABELS: Record<PixLinkState, string> = {
  awaiting: "Aguardando pagamento",
  expired_unpaid: "Expirou sem pagamento",
  paid: "Pago",
  canceled: "Cancelado",
};

export const PIX_LINK_STATE_TONES: Record<
  PixLinkState,
  "success" | "warning" | "destructive" | "neutral"
> = {
  awaiting: "warning",
  expired_unpaid: "destructive",
  paid: "success",
  canceled: "neutral",
};

/** The most recent Pix charge, which is the one that tells the renewal story. */
export function pickLatestPixCharge<
  T extends { status: string; expiresAt: Date | string; createdAt: Date | string },
>(links: T[], now: Date = new Date()): { link: T; state: PixLinkState } | null {
  if (links.length === 0) return null;
  const latest = [...links].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
  return { link: latest, state: getPixLinkState(latest, now) };
}
