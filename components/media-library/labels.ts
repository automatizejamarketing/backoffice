import { MEDIA_LIBRARY_ERROR_MESSAGES, type MediaLibraryClientErrorCode } from "@/lib/media-library/policy";

/** Textos dos componentes da biblioteca. O app traduz (next-intl); o backoffice usa o pt-BR. */
export type MediaLibraryLabels = {
  teamBadge: string;
  uploadedByCustomer: string;
  uploadedByPrefix: string;
  videoBadge: string;
  preview: string;
  download: string;
  delete: string;
  previewAria: (name: string) => string;
  downloadAria: (name: string) => string;
  deleteAria: (name: string) => string;
  selectAria: (name: string) => string;
  deleteTitle: string;
  deleteDescription: (name: string) => string;
  deleteCancel: string;
  deleteConfirm: string;
  upload: string;
  uploadHint: string;
  uploadDisabledClosed: string;
  uploadDisabledSubscription: string;
  uploading: string;
  uploaded: string;
  dismiss: string;
  empty: string;
  emptyHint: string;
  loadError: string;
  retry: string;
  loadMore: string;
  deleteSuccess: string;
  deleteError: string;
  downloadError: string;
  errorMessage: (code: MediaLibraryClientErrorCode) => string;
  formatDate: (iso: string) => string;
};

const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export const PT_BR_MEDIA_LIBRARY_LABELS: MediaLibraryLabels = {
  teamBadge: "Equipe Automatize",
  uploadedByCustomer: "Cliente",
  uploadedByPrefix: "Enviada por",
  videoBadge: "Vídeo",
  preview: "Ver",
  download: "Baixar",
  delete: "Excluir",
  previewAria: (name) => `Ver ${name}`,
  downloadAria: (name) => `Baixar ${name}`,
  deleteAria: (name) => `Excluir ${name}`,
  selectAria: (name) => `Selecionar ${name}`,
  deleteTitle: "Excluir mídia?",
  deleteDescription: (name) =>
    `"${name}" será removida da biblioteca. Anúncios já publicados com essa mídia não são afetados.`,
  deleteCancel: "Cancelar",
  deleteConfirm: "Excluir",
  upload: "Enviar mídias",
  uploadHint: "JPG ou PNG até 5 MB · MP4, MOV ou WEBM até 300 MB",
  uploadDisabledClosed: "Biblioteca encerrada: o acesso expirou há mais de 1 mês.",
  uploadDisabledSubscription: "Renove a assinatura para enviar novas mídias.",
  uploading: "Enviando…",
  uploaded: "Enviada",
  dismiss: "Dispensar",
  empty: "A biblioteca está vazia",
  emptyHint: "Envie fotos e vídeos do produto para usar nas campanhas.",
  loadError: "Não foi possível carregar as mídias.",
  retry: "Tentar de novo",
  loadMore: "Carregar mais",
  deleteSuccess: "Mídia excluída",
  deleteError: "Não foi possível excluir a mídia.",
  downloadError: "Não foi possível baixar a mídia.",
  errorMessage: (code) => MEDIA_LIBRARY_ERROR_MESSAGES[code],
  formatDate: (iso) => DATE_FORMAT.format(new Date(iso)),
};
