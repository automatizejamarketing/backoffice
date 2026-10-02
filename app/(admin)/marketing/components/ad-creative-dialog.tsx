"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { AdvertisingIdentitySelector } from "./advertising-identity-selector";
import { selectAdvertisingIdentity, type AdvertisingIdentitySelection } from "@/lib/meta-business/advertising-identity-selection";
import { useAdSetDetail } from "../hooks/marketing-queries";
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
  onCreated?: () => void;
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
  onEdited?: () => void;
};

type AdCreativeDialogProps = CreateModeProps | EditModeProps;

export function AdCreativeDialog(props: AdCreativeDialogProps) {
  const isEdit = props.mode === "edit";
  const [media, setMedia] = useState<SelectedMedia | null>(null);
  const [identity, setIdentity] = useState<AdvertisingIdentitySelection | null>(null);
  const [form, setForm] = useState<AdCreativeFormValue>(
    DEFAULT_AD_CREATIVE_FORM,
  );

  const { pages, isLoading: isLoadingPages } = usePages(
    props.accountId,
    props.userId,
    props.isOpen,
  );
  const prefilledIdentity = useRef(false);
  const originalIdentityQuery = useQuery<{ pageId?: string; instagramUserId?: string; adsetId?: string }>({
    queryKey: ["creative-identity", props.accountId, props.userId, props.mode === "edit" ? props.ad.id : null],
    enabled: props.isOpen && props.mode === "edit",
    queryFn: async () => {
      if (props.mode !== "edit") return {};
      const response = await fetch(`/api/meta-marketing/${props.accountId}/ads/${props.ad.id}/promotion-link?userId=${encodeURIComponent(props.userId)}`);
      if (!response.ok) throw new Error("Falha ao carregar a identidade atual do anúncio.");
      return response.json();
    },
  });
  const adsetQuery = useAdSetDetail(props.accountId, props.userId, props.mode === "create" ? props.adsetId : originalIdentityQuery.data?.adsetId ?? "", { enabled: props.isOpen && (props.mode === "create" || Boolean(originalIdentityQuery.data?.adsetId)) });
  const rawFixedPageId = adsetQuery.data?.adset?.promotedObject?.page_id;
  const fixedPageId = typeof rawFixedPageId === "string" ? rawFixedPageId : undefined;
  const selectedPageId = identity?.pageId ?? null;
  const selectedInstagramAccountId = identity?.instagramUserId;
  const selectedPair = pages.find(p => p.available !== false && p.pageId === selectedPageId && p.instagramBusinessAccountId === selectedInstagramAccountId);

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
      setIdentity(null);
      prefilledIdentity.current = false;
      setForm(DEFAULT_AD_CREATIVE_FORM);
      builder.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.isOpen]);

  useEffect(() => {
    if (!props.isOpen || isLoadingPages || (props.mode === "edit" && originalIdentityQuery.isLoading) || ((props.mode === "create" || Boolean(originalIdentityQuery.data?.adsetId)) && adsetQuery.isLoading)) return;
    setIdentity(current => {
      const original = !prefilledIdentity.current && originalIdentityQuery.data?.pageId ? { pageId: originalIdentityQuery.data.pageId, instagramUserId: originalIdentityQuery.data.instagramUserId } : current;
      prefilledIdentity.current = true;
      const next = selectAdvertisingIdentity(pages, original, true, fixedPageId);
      return next?.pageId === current?.pageId && next?.instagramUserId === current?.instagramUserId ? current : next;
    });
  }, [props.isOpen, props.mode, isLoadingPages, adsetQuery.isLoading, pages, fixedPageId, originalIdentityQuery.isLoading, originalIdentityQuery.data]);

  // Notify parent once, when the operation succeeds.
  useEffect(() => {
    if (builder.phase === "done") {
      if (props.mode === "create") props.onCreated?.();
      else props.onEdited?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builder.phase]);

  const isVideo = media?.source === "device" && media.mediaType === "video";
  const isInstagram = media?.source === "instagram";
  const formMode: "single" | "multi" = props.adSetIsDynamic ? "multi" : "single";

  const canSubmit = useMemo(() => {
    if (!media || !selectedPair || isLoadingPages || (props.mode === "create" && adsetQuery.isLoading)) return false;
    if (fixedPageId && selectedPageId !== fixedPageId) return false;
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
  }, [media, isInstagram, form, formMode, builder.phase, selectedPair, isLoadingPages, props.mode, adsetQuery.isLoading, fixedPageId, selectedPageId]);

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
                <AdvertisingIdentitySelector pages={pages} value={identity}
                  onChange={next => { setMedia(current => current?.source === "instagram" ? null : current); setIdentity(next); }}
                  isLoading={isLoadingPages} fixedPageId={fixedPageId} />
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
                        instagramUserId: selectedInstagramAccountId,
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
