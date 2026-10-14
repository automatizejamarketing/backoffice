import { PT_BR_MEDIA_LIBRARY_LABELS, type MediaLibraryLabels } from "@/components/media-library/labels";
import { formatDateTimeInSaoPaulo, formatNumericDateInSaoPaulo } from "@/lib/backoffice/datetime-format";
import type { MediaLibrarySummary } from "@/lib/media-library/service";

/**
 * Rótulos do backoffice: data e hora em São Paulo e verbo "Adicionar".
 * `closed` pode ser por expiração há mais de 1 mês OU por nunca ter sido ativado
 * (expiration_date nula), então o texto não afirma a causa.
 */
export const BACKOFFICE_MEDIA_LIBRARY_LABELS: MediaLibraryLabels = {
  ...PT_BR_MEDIA_LIBRARY_LABELS,
  upload: "Adicionar mídias",
  uploadDisabledClosed: "Biblioteca encerrada: nada pode ser adicionado.",
  uploadDisabledSubscription: "O cliente está sem acesso ativo.",
  formatDate: (iso) => formatDateTimeInSaoPaulo(iso),
};

/** Estado em DD/MM/AAAA (R9), no dia de São Paulo. */
export function describeMediaLibraryState(library: MediaLibrarySummary): string {
  if (library.state === "active") {
    return library.expirationDate
      ? `Ativa até ${formatNumericDateInSaoPaulo(library.expirationDate)}`
      : "Ativa (acesso liberado sem cobrança)";
  }
  if (library.state === "grace") {
    return `Carência — exclusão em ${formatNumericDateInSaoPaulo(library.purgeAt)}`;
  }
  return "Encerrada — o cliente precisa renovar o acesso";
}
