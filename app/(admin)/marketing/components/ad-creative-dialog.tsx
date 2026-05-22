"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AdCreativeForm,
  DEFAULT_AD_CREATIVE_FORM,
  hasValidDynamicText,
  hasValidSingleText,
  isValidHttpsUrl,
  type AdCreativeFormValue,
} from "./ad-creative-form";
import { AdMediaProcessingCard } from "./ad-media-processing-card";
import { MediaSourcePicker, type SelectedMedia } from "./media-source-picker";
import { PageSelector } from "./page-selector";
import { usePages } from "./use-pages";
import { useAdCreativeBuilder } from "./use-ad-creative-builder";

type CreateModeProps = {
  mode: "create";
  accountId: string;
  userId: string;
  adsetId: string;
  adsetName?: string;
  /**
   * Whether the target ad set has Dynamic Creative enabled. When true (legacy
   * ad sets created before this flow was migrated), the form accepts 1-5
   * titles / 1-5 texts. When false (or unset, which is the new default), the
   * form accepts exactly 1 title and 1 text and the creative is built as a
   * non-dynamic `object_story_spec`.
   */
  adSetIsDynamic?: boolean;
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
};

type EditModeProps = {
  mode: "edit";
  accountId: string;
  userId: string;
  ad: { id: string; name?: string };
  /** Same semantics as in create mode (the parent ad set of the ad). */
  adSetIsDynamic?: boolean;
  isOpen: boolean;
  onClose: () => void;
  onEdited: () => void;
};

type AdCreativeDialogProps = CreateModeProps | EditModeProps;

export function AdCreativeDialog(props: AdCreativeDialogProps) {
  const isEdit = props.mode === "edit";
  const [media, setMedia] = useState<SelectedMedia | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [form, setForm] = useState<AdCreativeFormValue>(
    DEFAULT_AD_CREATIVE_FORM,
  );

  const { pages, isLoading: isLoadingPages } = usePages(
    props.accountId,
    props.userId,
    props.isOpen,
  );
  const selectedPage =
    pages.find((page) => page.pageId === selectedPageId) ?? null;
  const selectedInstagramAccountId =
    selectedPage?.instagramBusinessAccountId ?? undefined;

  const builder = useAdCreativeBuilder(
    props.mode === "create"
      ? {
          mode: "create",
          accountId: props.accountId,
          userId: props.userId,
          adsetId: props.adsetId,
        }
      : {
          mode: "edit",
          accountId: props.accountId,
          userId: props.userId,
          adId: props.ad.id,
        },
  );

  // Reset everything whenever the dialog is (re)opened.
  useEffect(() => {
    if (props.isOpen) {
      setMedia(null);
      setSelectedPageId(null);
      setForm(DEFAULT_AD_CREATIVE_FORM);
      builder.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.isOpen]);

  // Notify parent once, when the operation succeeds.
  useEffect(() => {
    if (builder.phase === "done") {
      if (props.mode === "create") props.onCreated();
      else props.onEdited();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builder.phase]);

  const isVideo = media?.source === "device" && media.mediaType === "video";
  const isInstagram = media?.source === "instagram";
  const formMode: "single" | "multi" = props.adSetIsDynamic ? "multi" : "single";

  const canSubmit = useMemo(() => {
    if (!media) return false;
    if (!isValidHttpsUrl(form.linkUrl)) return false;
    // Instagram keeps its own caption; image/video need the text matching the
    // ad set's mode (1 title + 1 text for non-dynamic, 1-5 each for legacy).
    if (!isInstagram) {
      const textOk =
        formMode === "single"
          ? hasValidSingleText(form)
          : hasValidDynamicText(form);
      if (!textOk) return false;
    }
    return builder.phase === "editing" || builder.phase === "error";
  }, [media, isInstagram, form, formMode, builder.phase]);

  const showForm =
    builder.phase === "editing" || builder.phase === "error";

  const title = isEdit ? "Editar criativo do anúncio" : "Criar anúncio";
  const description = isEdit
    ? "Substitua a mídia e o texto do anúncio. Se o anúncio já estiver ativo/engajado, um novo anúncio será criado no mesmo conjunto e o original pausado."
    : "Crie um novo anúncio neste conjunto escolhendo a mídia e o texto do criativo.";

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-hidden p-0 sm:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex max-h-[90vh] flex-col">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {builder.phase === "done" ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <CheckCircle2 className="size-10 text-emerald-500" />
                {builder.result?.kind === "duplicate_paused" ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-left text-sm text-amber-700 dark:text-amber-400">
                    <Info className="mt-0.5 size-4 shrink-0" />
                    <span>{builder.result.message}</span>
                  </div>
                ) : (
                  <p className="text-sm font-medium">
                    {isEdit
                      ? "Criativo atualizado no anúncio existente."
                      : "Anúncio criado com sucesso."}
                  </p>
                )}
              </div>
            ) : showForm ? (
              <div className="flex flex-col gap-5">
                {builder.phase === "error" && builder.error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <div className="space-y-0.5">
                      <p className="font-medium">
                        {isEdit
                          ? "Não foi possível atualizar o criativo"
                          : "Não foi possível criar o anúncio"}
                      </p>
                      <p className="text-destructive/90">{builder.error}</p>
                    </div>
                  </div>
                )}
                <div className="space-y-3">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Página do Facebook (Identidade)
                    </p>
                    <PageSelector
                      pages={pages}
                      isLoading={isLoadingPages}
                      selectedPageId={selectedPageId}
                      onSelectPage={setSelectedPageId}
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Conta do Instagram
                    </p>
                    <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                      {isLoadingPages ? (
                        <span className="truncate">Carregando...</span>
                      ) : selectedPage ? (
                        <>
                          <Avatar className="size-5 shrink-0">
                            <AvatarImage
                              src={selectedPage.instagramProfilePictureUrl}
                              alt={selectedPage.instagramUsername ?? ""}
                            />
                            <AvatarFallback className="text-[10px]">
                              {(selectedPage.instagramUsername ?? "?")
                                .charAt(0)
                                .toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate text-foreground">
                            {selectedPage.instagramUsername
                              ? `@${selectedPage.instagramUsername}`
                              : selectedPage.instagramBusinessAccountId}
                          </span>
                        </>
                      ) : (
                        <span className="truncate">Selecione uma página</span>
                      )}
                    </div>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Mídia do criativo
                  </p>
                  <MediaSourcePicker
                    accountId={props.accountId}
                    userId={props.userId}
                    onChange={setMedia}
                    instagramBusinessAccountId={selectedInstagramAccountId}
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Texto do anúncio
                  </p>
                  <AdCreativeForm
                    value={form}
                    onChange={setForm}
                    hideText={isInstagram}
                    showStatus={!isEdit}
                    mode={formMode}
                  />
                </div>
              </div>
            ) : (
              <AdMediaProcessingCard
                phase={builder.phase}
                isVideo={Boolean(isVideo)}
                isEdit={isEdit}
                videoProgress={builder.videoProgress}
                errorMessage={builder.error}
              />
            )}
          </div>

          <DialogFooter className="border-t px-6 py-4">
            {builder.phase === "done" ? (
              <Button onClick={props.onClose}>Fechar</Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onClick={props.onClose}
                  disabled={
                    builder.phase === "submitting" ||
                    builder.phase === "processing"
                  }
                >
                  Cancelar
                </Button>
                <Button
                  disabled={!canSubmit}
                  onClick={() => {
                    if (media)
                      builder.submit({
                        media,
                        text: form,
                        pageId: selectedPageId,
                      });
                  }}
                >
                  {builder.phase === "submitting" ||
                  builder.phase === "processing" ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {builder.phase === "processing"
                        ? "Processando vídeo..."
                        : "Enviando..."}
                    </>
                  ) : isEdit ? (
                    "Salvar criativo"
                  ) : (
                    "Criar anúncio"
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
