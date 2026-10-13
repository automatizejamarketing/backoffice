import { PT_BR_MEDIA_LIBRARY_LABELS, type MediaLibraryLabels } from "@/components/media-library/labels";
import { formatDateInSaoPaulo, formatDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import type { MediaLibrarySummary } from "@/lib/media-library/service";

/** Rótulos do backoffice: data e hora em São Paulo e verbo "Adicionar". */
export const BACKOFFICE_MEDIA_LIBRARY_LABELS: MediaLibraryLabels = {
  ...PT_BR_MEDIA_LIBRARY_LABELS,
  upload: "Adicionar mídias",
  uploadDisabledSubscription: "O cliente está sem acesso ativo.",
  formatDate: (iso) => formatDateTimeInSaoPaulo(iso),
};

export function describeMediaLibraryState(library: MediaLibrarySummary): string {
  if (library.state === "active") {
    return library.expirationDate
      ? `Ativa até ${formatDateInSaoPaulo(library.expirationDate)}`
      : "Ativa (acesso liberado sem cobrança)";
  }
  if (library.state === "grace") {
    return `Carência — exclusão em ${formatDateInSaoPaulo(library.purgeAt)}`;
  }
  return "Encerrada — o cliente precisa renovar o acesso";
}
